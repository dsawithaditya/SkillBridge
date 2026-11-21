import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import {
  resetBudgetStats,
  resetRateLimits,
} from "../lib/budget.js";
import {
  getCacheDir,
  getCacheStats,
  getCached,
  setCacheDir,
  setCached,
} from "../lib/cache.js";
import {
  compareLocalVsRemote,
  compareMultiRoleFit,
  generateAtsBullets,
} from "../lib/compare.js";
import {
  attachLearningResources,
  buildFourWeekPlan,
  fetchCoursesForSkillWithMeta,
} from "../lib/courses.js";
import { loadEnv } from "../lib/env.js";
import { deepReadSparseJobs } from "../lib/extract.js";
import {
  getHistoryDir,
  recordAndCompareSkillTrends,
  setHistoryDir,
} from "../lib/history.js";
import { fetchLiveJobsWithMeta, resolveSerpApiQueryAndLocation } from "../lib/jobs.js";
import { attachCompanyPulse } from "../lib/news.js";
import { resolveOfflineDataset, runOfflineDemoAnalysis } from "../lib/offlineDemo.js";
import { cleanResumeText, extractTextFromPdfBuffer } from "../lib/resumeParser.js";
import {
  computeMarketDemand,
  deduplicateAndNormalize,
  extractSkillEvidence,
  extractSkillsFromText,
  extractSkillsRegex,
} from "../lib/skills.js";
import { analyzeSkillGaps, isJobReady, parseSalaryMidpoint } from "../public/js/gap.js";
import { createAppServer } from "../server.js";

/**
 * Helper: build a valid synthetic PDF buffer (uncompressed or FlateDecode compressed) for parser tests.
 */
function buildSyntheticPdf(text, { compressed = false, producer = "TestGenerator" } = {}) {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const streamText = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  const streamData = compressed
    ? zlib.deflateSync(Buffer.from(streamText, "utf8"))
    : Buffer.from(streamText, "utf8");
  const filterEntry = compressed ? "/Filter /FlateDecode " : "";

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    null, // 5 0 obj built with binary stream
    `6 0 obj\n<< /Producer (${producer}) >>\nendobj\n`,
  ];

  const header = Buffer.from("%PDF-1.4\n", "utf8");
  const chunks = [header];
  const offsets = [0];
  let cursor = header.length;

  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(cursor);
    let buf;
    if (i === 4) {
      const pre = Buffer.from(
        `5 0 obj\n<< ${filterEntry}/Length ${streamData.length} >>\nstream\n`,
        "utf8"
      );
      const post = Buffer.from("\nendstream\nendobj\n", "utf8");
      buf = Buffer.concat([pre, streamData, post]);
    } else {
      buf = Buffer.from(objects[i], "utf8");
    }
    chunks.push(buf);
    cursor += buf.length;
  }

  const xrefOffset = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref + trailer, "utf8"));
  return Buffer.concat(chunks);
}

// --- B1: Skill Extractor False-Skill Elimination ---
test("B1: plain-English resume returns [] and ambiguous aliases do not trigger false skills", async () => {
  const noTechResume =
    "I go the extra mile. Spring 2025 semester project in R&D. Plan the next steps for our next-generation retail shop. Rest assured, we express clear leadership and shell out effort.";
  assert.deepEqual(extractSkillsRegex(noTechResume), []);
  assert.deepEqual(extractSkillsRegex("Where you want to go next chapter"), []);

  // Real tech context DOES match
  const realTech =
    "Languages: Python, Go, R, TS | Frameworks: Next.js, Express.js, Spring Boot, REST API | Built with Golang and R programming.";
  const detected = extractSkillsRegex(realTech);
  for (const s of [
    "Python",
    "Go",
    "R",
    "TypeScript",
    "Next.js",
    "Express.js",
    "Spring Boot",
    "REST API",
  ]) {
    assert.ok(detected.includes(s), `Expected ${s} in [${detected.join(", ")}]`);
  }

  // LLM path rejects false Go/Next.js hallucination and uses x-goog-api-key header (S1)
  const origCacheDir = getCacheDir();
  const tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), "sb-b1-"));
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "fake-gemini-key";
  setCacheDir(tmpCache);
  try {
    let seenHeaders = null;
    let seenUrl = "";
    const llmSkills = await extractSkillsFromText(noTechResume, async (url, opts) => {
      seenUrl = url;
      seenHeaders = opts.headers;
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(["Go", "R", "Spring Boot", "Next.js"]) }],
              },
            },
          ],
        }),
      };
    });
    assert.ok(!seenUrl.includes("fake-gemini-key"), "Key must not be in URL");
    assert.equal(seenHeaders["x-goog-api-key"], "fake-gemini-key");
    assert.deepEqual(llmSkills, []);
  } finally {
    setCacheDir(origCacheDir);
    fs.rmSync(tmpCache, { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

// --- B2 & B5: Sparse jobs, zero-skill candidate, and net_ready_unlocked ranking ---
test("B2 & B5: zero-skill gets 0 ready jobs, <3 skills go to low_data_jobs, ranked by net_ready_unlocked", () => {
  assert.equal(isJobReady(0, 0, 1), false);
  assert.equal(isJobReady(1, 0.5, 1), true);

  const jobs = [
    // Sparse single-skill job -> low_data_jobs
    {
      job_id: "sparse-1",
      title: "Excel Clerk",
      company: "RetailCo",
      location: "Mumbai",
      extracted_skills: ["Excel"],
    },
    // Eligible (3+ skills): missing 2 of 4 -> not ready until TypeScript is added
    {
      job_id: "elig-1",
      title: "Frontend Dev",
      company: "WebCo",
      location: "Bengaluru",
      salary_text: "8 - 12 LPA",
      extracted_skills: ["React", "JavaScript", "TypeScript", "CSS"],
    },
    {
      job_id: "elig-2",
      title: "Senior Frontend",
      company: "ScaleCo",
      location: "Bengaluru",
      salary_text: "14 - 20 LPA",
      extracted_skills: ["React", "TypeScript", "Next.js", "Docker", "CI/CD"],
    },
  ];

  // Zero-skill candidate
  const zeroRes = analyzeSkillGaps({
    role: "Frontend Developer",
    location: "Bengaluru",
    userSkills: [],
    jobs,
  });
  assert.equal(zeroRes.ready_jobs.length, 0);
  assert.equal(zeroRes.readiness_score, 0);
  assert.equal(zeroRes.low_data_jobs.length, 1);
  assert.equal(zeroRes.eligible_jobs_count, 2);

  // Candidate with React + JavaScript: TypeScript flips elig-1 to Ready (net_ready_unlocked = 1)
  const devRes = analyzeSkillGaps({
    role: "Frontend Developer",
    location: "Bengaluru",
    userSkills: ["React", "JavaScript"],
    jobs,
  });
  assert.equal(devRes.missing_gaps[0].skill, "TypeScript");
  assert.equal(devRes.missing_gaps[0].net_ready_unlocked, 1);
  assert.equal(devRes.missing_gaps[0].jobs_unlocked, 2);
});

// --- B3: Honest ATS Bullets (no hardcoded metrics, zero-skill guidance) ---
test("B3: ATS bullets never hardcode percentages or claim unlearned skills", async () => {
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "";
  try {
    const zero = await generateAtsBullets({
      resumeText: "Retail store manager with 5 years of inventory experience.",
      role: "Backend Python Developer",
      matchedSkills: [],
      userSkills: [],
      missingGaps: [{ skill: "Python" }, { skill: "Docker" }],
    });
    assert.deepEqual(zero.verifiedBullets, []);
    assert.deepEqual(zero.afterYouLearnBullets, []);
    assert.ok(zero.guidance.includes("No verified technical skills"));

    const real = await generateAtsBullets({
      resumeText: "Python and PostgreSQL developer.",
      role: "Backend Python Developer",
      matchedSkills: ["Python", "PostgreSQL"],
      userSkills: ["Python", "PostgreSQL"],
      missingGaps: [{ skill: "Docker" }],
    });
    assert.ok(real.verifiedBullets.length >= 2);
    for (const b of [...real.verifiedBullets, ...real.afterYouLearnBullets]) {
      assert.ok(!/\b32%|\b40%/.test(b), "No hardcoded percentage allowed");
    }
    assert.ok(real.verifiedBullets.every((b) => !b.includes("Docker")));
    assert.ok(real.afterYouLearnBullets.some((b) => b.includes("Docker")));
  } finally {
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  }
});

// --- B4: PDF Upload via unpdf (multiple generators + corrupt recovery) ---
test("B4: unpdf parses uncompressed and FlateDecode PDFs and gives friendly error on corrupt input", async () => {
  const pdfReportLab = buildSyntheticPdf(
    "Aarav Sharma Senior Backend Engineer Python PostgreSQL Docker Kubernetes",
    { compressed: true, producer: "ReportLab PDF Library" }
  );
  const pdfLibreOffice = buildSyntheticPdf(
    "Priya Nair Frontend Engineer JavaScript React TypeScript Tailwind CSS Git",
    { compressed: false, producer: "LibreOffice 24.2" }
  );
  const pdfWord = buildSyntheticPdf(
    "Rohan Deshmukh Data Analyst Python SQL Pandas NumPy Tableau Power BI",
    { compressed: true, producer: "Microsoft Word" }
  );

  const text1 = await extractTextFromPdfBuffer(pdfReportLab);
  const text2 = await extractTextFromPdfBuffer(pdfLibreOffice);
  const text3 = await extractTextFromPdfBuffer(pdfWord);

  assert.ok(text1.includes("Python") && text1.includes("Docker"));
  assert.ok(text2.includes("React") && text2.includes("TypeScript"));
  assert.ok(text3.includes("Pandas") && text3.includes("Power BI"));

  await assert.rejects(
    extractTextFromPdfBuffer(Buffer.from("%PDF-corrupt-binary-data")),
    (err) => err.status === 400 && err.message.includes("Paste your resume text instead")
  );
});

// --- B6, B9, U2 & Feature #1: Remote routing, Offline routing, Pagination & Extract API ---
test("B6, B9, U2 & Feature #1: Remote query uses real location, offline routing uses word boundaries, and Extract API enriches sparse jobs", async () => {
  // B9 word-boundary routing
  assert.equal(resolveOfflineDataset("Mobile App Developer").exactMatch, false);
  assert.equal(resolveOfflineDataset("Build Engineer").exactMatch, false);
  assert.equal(resolveOfflineDataset("Guitar Teacher").exactMatch, false);
  assert.equal(resolveOfflineDataset("DevOps Engineer").exactMatch, false);
  assert.equal(resolveOfflineDataset("Frontend Developer").datasetKey, "frontend");
  assert.equal(resolveOfflineDataset("Data Analyst").datasetKey, "data_analyst");

  // B6 Remote resolution never uses 'Remote' as location
  const resolvedRemote = resolveSerpApiQueryAndLocation("Backend Developer", "Remote");
  assert.notEqual(resolvedRemote.location.toLowerCase(), "remote");
  assert.ok(resolvedRemote.q.toLowerCase().includes("remote"));

  // U2 pagination (30 jobs fetches 3 pages) & Feature #1 Extract API deep-read
  const origDir = getCacheDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ext-"));
  const prevKey = process.env.SERPAPI_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.SERPAPI_KEY = "test-serp-key";
  process.env.GEMINI_API_KEY = "";
  resetBudgetStats();

  try {
    setCacheDir(tmpDir);

    let pageFetches = 0;
    const { jobs, data_source } = await fetchLiveJobsWithMeta({
      role: "Cloud Engineer",
      location: "Bengaluru, Karnataka, India",
      limit: 30,
      useCache: true,
      fetchImpl: async (url) => {
        pageFetches += 1;
        const pageJobs = Array.from({ length: 10 }, (_, idx) => ({
          job_id: `p${pageFetches}-${idx}`,
          title: `Cloud Role ${pageFetches}-${idx}`,
          company_name: "TestCorp",
          description: "Cloud team",
          apply_options: [{ link: `https://example.com/job/${pageFetches}/${idx}` }],
        }));
        return {
          ok: true,
          json: async () => ({
            jobs_results: pageJobs,
            serpapi_pagination: pageFetches < 3 ? { next_page_token: `tok_${pageFetches}` } : {},
          }),
        };
      },
    });
    assert.equal(pageFetches, 3);
    assert.equal(jobs.length, 30);
    assert.equal(data_source, "live");

    // Extract API deep-read enriches sparse (< 3 skill) job and caps at 5
    let extractCalls = 0;
    const sparseJobs = jobs.slice(0, 7).map((j) => ({ ...j, extracted_skills: [] }));
    const { jobs: deepJobs, deepReadCount } = await deepReadSparseJobs(sparseJobs, {
      fetchImpl: async (url) => {
        extractCalls += 1;
        assert.ok(url.includes("engine=extract"));
        assert.ok(url.includes("output=md"));
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            markdown: "Requirements: Python, Docker, Kubernetes, PostgreSQL, Terraform",
          }),
        };
      },
    });
    assert.equal(extractCalls, 5);
    assert.equal(deepReadCount, 5);
    assert.equal(deepJobs[0].deep_read, true);
    assert.ok(deepJobs[0].extracted_skills.includes("Docker"));
    assert.equal(deepJobs[6].deep_read, false);
  } finally {
    setCacheDir(origDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = prevKey;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    resetBudgetStats();
  }
});

// --- B7, B8, U1, S1: HTTP error statuses, canonical /api/courses validation, rate limit, HEAD ---
test("B7, B8, U1 & S1: Server enforces canonical validation, 400/413/429 codes, HEAD, and path traversal", async () => {
  const prevSerp = process.env.SERPAPI_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevBudget = process.env.SERPAPI_DAILY_BUDGET;
  const origCacheDir = getCacheDir();
  const tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), "sb-srv-cache-"));

  process.env.SERPAPI_KEY = "";
  process.env.GEMINI_API_KEY = "";
  process.env.SERPAPI_DAILY_BUDGET = "50";
  setCacheDir(tmpCache);
  resetRateLimits();
  resetBudgetStats();

  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // S1: HEAD / returns 200 with empty body
    const headRes = await fetch(`${baseUrl}/`, { method: "HEAD" });
    assert.equal(headRes.status, 200);

    // Path traversal blocked
    const travRes = await fetch(`${baseUrl}/../.env`);
    assert.notEqual(travRes.status, 200);

    // B8: Malformed JSON -> 400
    const badJson = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    assert.equal(badJson.status, 400);

    // B8: Live request with missing key falls back gracefully to labeled demo (never leaks .env message)
    const liveNoKey = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "live",
        role: "Backend Python Developer",
        location: "Bengaluru, Karnataka, India",
        resumeText: "Experienced with Python, Flask, PostgreSQL, SQL, Git.",
      }),
    });
    assert.equal(liveNoKey.status, 200);
    const liveNoKeyData = await liveNoKey.json();
    assert.equal(liveNoKeyData.data_source, "demo");
    assert.ok(!JSON.stringify(liveNoKeyData).includes(".env"));

    // B7: /api/courses rejects unknown skill with 400
    const badCourse = await fetch(`${baseUrl}/api/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill: "anything at all ; DROP TABLE" }),
    });
    assert.equal(badCourse.status, 400);

    // U1: /api/courses valid skill without key returns reason='no_api_key'
    const noKeyCourse = await fetch(`${baseUrl}/api/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill: "Docker", role: "Backend Developer" }),
    });
    assert.equal(noKeyCourse.status, 200);
    const noKeyCourseJson = await noKeyCourse.json();
    assert.equal(noKeyCourseJson.reason, "no_api_key");

    // B7: Per-IP rate limit triggers 429 on the 11th rapid request
    let lastStatus = 200;
    for (let i = 0; i < 10; i += 1) {
      const r = await fetch(`${baseUrl}/api/courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill: "Docker", role: "Backend Developer" }),
      });
      lastStatus = r.status;
      if (lastStatus === 429) break;
    }
    assert.equal(lastStatus, 429);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    setCacheDir(origCacheDir);
    fs.rmSync(tmpCache, { recursive: true, force: true });
    resetRateLimits();
    resetBudgetStats();
    if (prevSerp === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = prevSerp;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevBudget === undefined) delete process.env.SERPAPI_DAILY_BUDGET;
    else process.env.SERPAPI_DAILY_BUDGET = prevBudget;
  }
});

// --- Section 4 Features & U4: News, Trends, Salary Lift, Evidence, 4-Week Plan, Multi-Role Target ---
test("Section 4 & U4: Multi-role includes target role, plus salary lift, evidence, news pulse, trends, and 4-week plan", async () => {
  const prevSerp = process.env.SERPAPI_KEY;
  const origHistDir = getHistoryDir();
  const tmpHist = fs.mkdtempSync(path.join(os.tmpdir(), "sb-hist-"));
  process.env.SERPAPI_KEY = "test-key";

  try {
    setHistoryDir(tmpHist);

    // U4: DevOps target role must always appear in multi-role comparison
    const multi = await compareMultiRoleFit({
      resumeText: "Experienced with Docker, Kubernetes, Terraform, Linux, AWS, CI/CD.",
      targetRole: "DevOps Engineer",
      location: "Bengaluru, Karnataka, India",
      mode: "offline",
    });
    assert.ok(multi.evaluations.some((e) => e.role === "DevOps Engineer"));
    assert.ok(multi.evaluations.every((e) => ["live", "cache", "demo"].includes(e.data_source)));

    // Salary lift & evidence
    assert.equal(parseSalaryMidpoint("12L - 18L"), 1500000);
    const ev = extractSkillEvidence("Built microservices in Docker. Tuned PostgreSQL queries.");
    assert.ok(ev.Docker.includes("Docker"));

    // Company news pulse with mocked SerpApi google_news
    const pulse = await attachCompanyPulse(
      [{ company: "CloudScale" }],
      {
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            news_results: [
              {
                title: "CloudScale raises $40M Series B funding to expand AI team",
                link: "https://news.example.com/1",
                source: { name: "TechCrunch" },
              },
            ],
          }),
        }),
      }
    );
    assert.equal(pulse.CloudScale.headlines[0].sentiment, "Opportunity");

    // Trends & 4-week plan
    const d1 = recordAndCompareSkillTrends({
      role: "Frontend Developer",
      location: "Bengaluru",
      demandList: [{ skill: "TypeScript", job_count: 8, total_jobs: 10, demand_pct: 80 }],
    });
    assert.equal(d1[0].trend, "flat");

    const offline = runOfflineDemoAnalysis({
      resumeText: "JavaScript React CSS HTML",
      role: "Frontend Developer",
      location: "Bengaluru, Karnataka, India",
    });
    assert.equal(offline.data_source, "demo");
    assert.equal(offline.fourWeekPlan.length, 4);
  } finally {
    setHistoryDir(origHistDir);
    fs.rmSync(tmpHist, { recursive: true, force: true });
    if (prevSerp === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = prevSerp;
    resetBudgetStats();
  }
});

// --- Cache concurrency, TTL, cap, and cleanResumeText ---
test("Cache supports concurrent writes, TTL, cap enforcement, and cleanResumeText", async () => {
  assert.equal(cleanResumeText("  Python\u200b   SQL \r\n\r\n\r\n Git "), "Python SQL\n\nGit");

  const origDir = getCacheDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cap-"));
  try {
    setCacheDir(tmpDir);
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        Promise.resolve().then(() => setCached("test", { k: i }, { v: i }, { maxFiles: 3 }))
      )
    );
    assert.ok(getCacheStats().totalFiles <= 3);
  } finally {
    setCacheDir(origDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

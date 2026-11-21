/**
 * SkillBridge HTTP server (pure Node.js) serving static HTML/CSS/JS and JSON APIs.
 * Hardened with typed errors (B8), rate limiting & budget guards (B7), HEAD & path.relative (S1),
 * Extract API deep-read (#1), Company Pulse (#2), and Skill Trends (#4).
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canSpendSerpApiCredit,
  checkAndRecordRateLimit,
  getBudgetStats,
} from "./lib/budget.js";
import { getCacheStats } from "./lib/cache.js";
import {
  compareLocalVsRemote,
  compareMultiRoleFit,
  generateAtsBullets,
} from "./lib/compare.js";
import {
  attachLearningResources,
  buildFourWeekPlan,
  buildMiniProjectIdea,
  fetchCoursesForSkillWithMeta,
} from "./lib/courses.js";
import { loadEnv } from "./lib/env.js";
import {
  AppError,
  BadRequestError,
  PayloadTooLargeError,
} from "./lib/errors.js";
import { deepReadSparseJobs } from "./lib/extract.js";
import { recordAndCompareSkillTrends } from "./lib/history.js";
import { fetchLiveJobsWithMeta, hasCachedJobsForQuery } from "./lib/jobs.js";
import { attachCompanyPulse } from "./lib/news.js";
import { CITY_OPTIONS, runOfflineDemoAnalysis } from "./lib/offlineDemo.js";
import { cleanResumeText, extractTextFromPdfBuffer } from "./lib/resumeParser.js";
import {
  computeMarketDemand,
  enrichJobsWithSkills,
  extractSkillEvidence,
  extractSkillsFromText,
  getCanonicalSkillName,
  getCanonicalSkillsCount,
} from "./lib/skills.js";
import { analyzeSkillGaps } from "./public/js/gap.js";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const SAMPLE_RESUMES_PATH = path.join(ROOT_DIR, "data", "sample_resumes.json");
const MAX_BODY_BYTES = 7 * 1024 * 1024; // Covers 5 MB PDF in base64 (~6.7 MB)

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

const FALLBACK_PRESETS = [
  {
    label: "CS Final-Year Student (Frontend)",
    role: "Frontend Developer",
    city: CITY_OPTIONS[0],
    text:
      "Frontend developer with internship experience in JavaScript (ES6+), HTML5, CSS3, " +
      "React.js, Tailwind CSS, Git, and REST APIs. Built responsive single-page apps.",
  },
  {
    label: "Junior Python Developer (Backend)",
    role: "Backend Python Developer",
    city: CITY_OPTIONS[0],
    text:
      "Backend developer experienced in Python 3, SQL, Flask, Django REST Framework, " +
      "PostgreSQL, SQLite, Git, Linux, REST API, and Agile sprints.",
  },
  {
    label: "Data Science Graduate (Data Analyst)",
    role: "Data Analyst",
    city: CITY_OPTIONS[1],
    text:
      "Entry-level Data Analyst skilled in Python, SQL, Pandas, NumPy, Tableau, and Microsoft Excel.",
  },
];

export function loadSamplePresets() {
  if (fs.existsSync(SAMPLE_RESUMES_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SAMPLE_RESUMES_PATH, "utf8"));
      if (Array.isArray(raw) && raw.length > 0) {
        return raw
          .filter((item) => item && typeof item === "object" && (item.resume_text || item.text))
          .map((item, idx) => ({
            label: String(item.name || item.label || `Sample Resume ${idx + 1}`),
            role: String(item.target_role || item.role || "Backend Python Developer"),
            city: String(item.default_city || item.city || CITY_OPTIONS[0]),
            text: String(item.resume_text || item.text || ""),
          }));
      }
    } catch {
      // Fallback safely
    }
  }
  return FALLBACK_PRESETS;
}

async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
      return req.body;
    }
    if (typeof req.body === "string") {
      if (!req.body) return {};
      try {
        return JSON.parse(req.body);
      } catch {
        throw new BadRequestError("Malformed JSON request body.");
      }
    }
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new PayloadTooLargeError(
        "Uploaded payload is too large (max 5 MB PDF). Paste your resume text instead."
      );
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError("Malformed JSON request body.");
  }
}

function sendJson(res, statusCode, data, headOnly = false) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(headOnly ? undefined : body);
}

function serveStaticFile(res, urlPath, headOnly = false) {
  const cleanPath = urlPath === "/" ? "/index.html" : urlPath;
  const resolved = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
  const rel = path.relative(PUBLIC_DIR, resolved);

  // S1: Safe path.relative check for traversal protection
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    res.writeHead(403);
    res.end();
    return;
  }

  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404);
    res.end(headOnly ? undefined : "Not Found");
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  if (headOnly) {
    res.end();
    return;
  }

  const stream = fs.createReadStream(resolved);
  stream.on("error", (err) => {
    console.error("[static] Stream error:", err);
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  });
  stream.pipe(res);
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "127.0.0.1";
}

function resolveAllowedUseCache(bodyUseCache) {
  // B7: Ignore client useCache=false unless ADMIN_MODE is explicitly enabled
  const adminMode = ["true", "1", "yes"].includes(
    String(process.env.ADMIN_MODE || "").trim().toLowerCase()
  );
  if (adminMode && bodyUseCache === false) {
    return false;
  }
  return true;
}

async function runLivePipeline({
  resumeText,
  role,
  location,
  limit = 10,
  useCache = true,
  includeNews = false,
}) {
  const userSkills = await extractSkillsFromText(resumeText);
  const resumeEvidence = extractSkillEvidence(resumeText);

  const { jobs: rawJobs, data_source, budgetExhausted } =
    await fetchLiveJobsWithMeta({
      role,
      location,
      limit,
      useCache,
    });

  let enrichedJobs = await enrichJobsWithSkills(rawJobs);

  // Feature #1: Deep-read sparse job listings (< 3 skills) via SerpApi Extract API
  const { jobs: deepReadJobs, deepReadCount } = await deepReadSparseJobs(
    enrichedJobs
  );
  enrichedJobs = deepReadJobs;

  const rawDemandList = computeMarketDemand(enrichedJobs, { minSkills: 3 });
  const demandWithTrends = recordAndCompareSkillTrends({
    role,
    location,
    demandList: rawDemandList,
  });

  const baseline = analyzeSkillGaps({
    role,
    location,
    userSkills,
    jobs: enrichedJobs,
    demandList: demandWithTrends,
  });

  const enrichedTopGaps = await attachLearningResources(
    baseline.missing_gaps,
    role,
    4
  );
  const coursesBySkill = {};
  for (const gap of enrichedTopGaps) {
    coursesBySkill[gap.skill] = gap;
  }

  const companyPulse = includeNews
    ? await attachCompanyPulse(enrichedJobs, { maxCompanies: 4 })
    : {};

  const atsBullets = await generateAtsBullets({
    resumeText,
    role,
    matchedSkills: baseline.matched_skills,
    userSkills,
    missingGaps: baseline.missing_gaps,
  });

  let notice = "";
  if (budgetExhausted) {
    notice =
      "Daily live search budget reached — serving cached market data to protect credits.";
  }

  return {
    role,
    location,
    resumeText,
    data_source,
    analysisMode: "live_or_cached",
    offlineDemoNotice: notice,
    userSkills,
    resumeEvidence,
    jobs: enrichedJobs,
    demandList: baseline.demand_list,
    baseline,
    coursesBySkill,
    fourWeekPlan: buildFourWeekPlan(enrichedTopGaps, role),
    deepReadCount,
    companyPulse,
    atsBullets,
    cacheStats: getCacheStats(),
    budgetStats: getBudgetStats(),
  };
}

const ROLE_SIGNALS = [
  {
    role: "Frontend Developer",
    keywords: ["frontend", "front-end", "react", "javascript", "typescript", "html", "css", "tailwind", "next.js", "vue", "angular", "figma", "ui"],
  },
  {
    role: "Data Analyst",
    keywords: ["data analyst", "analytics", "pandas", "numpy", "tableau", "power bi", "excel", "statistics", "dashboard", "machine learning", "sql"],
  },
  {
    role: "Backend Python Developer",
    keywords: ["backend", "back-end", "python", "django", "flask", "fastapi", "node.js", "express", "postgresql", "mysql", "mongodb", "rest api", "docker", "java", "spring"],
  },
];

/** Pick the closest supported target role from resume keywords. */
export function inferRoleFromResume(resumeText) {
  const text = ` ${String(resumeText || "").toLowerCase()} `;
  let best = ROLE_SIGNALS[2];
  let bestScore = 0;
  for (const signal of ROLE_SIGNALS) {
    let score = 0;
    for (const kw of signal.keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = text.match(new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "g"));
      if (matches) score += matches.length;
    }
    if (score > bestScore) {
      best = signal;
      bestScore = score;
    }
  }
  return best.role;
}

export async function handleAppRequest(req, res) {
  loadEnv();
  const reqUrl = new URL(req.url || "/", "http://localhost");
  const pathname = reqUrl.pathname;
  const isHead = req.method === "HEAD";

  try {
      if ((req.method === "GET" || isHead) && pathname === "/api/health") {
        return sendJson(
          res,
          200,
          {
            ok: true,
            runtime: "nodejs",
            canonicalSkills: getCanonicalSkillsCount(),
            cache: getCacheStats(),
            budget: getBudgetStats(),
          },
          isHead
        );
      }

      if ((req.method === "GET" || isHead) && pathname === "/api/presets") {
        return sendJson(
          res,
          200,
          {
            presets: loadSamplePresets(),
            cities: CITY_OPTIONS,
            cache: getCacheStats(),
            budget: getBudgetStats(),
          },
          isHead
        );
      }

      if (req.method === "POST" && pathname === "/api/analyze") {
        const body = await readJsonBody(req);
        let role = String(body.role || "").trim();
        const location = String(body.location || CITY_OPTIONS[0]).trim();
        const mode = String(body.mode || "live");
        const limit = [10, 20, 30].includes(Number(body.limit))
          ? Number(body.limit)
          : 10;
        const useCache = resolveAllowedUseCache(body.useCache);

        if (mode !== "offline") {
          checkAndRecordRateLimit(getClientIp(req));
        }

        let resumeText = "";
        if (body.pdfBase64) {
          const base64Str = String(body.pdfBase64).replace(
            /^data:[^;]+;base64,/,
            ""
          );
          const pdfBuffer = Buffer.from(base64Str, "base64");
          resumeText = await extractTextFromPdfBuffer(pdfBuffer);
        } else {
          resumeText = cleanResumeText(String(body.resumeText || ""));
        }

        if (resumeText.length < 20) {
          throw new BadRequestError(
            "We couldn't read text from that file. Please upload a text-based PDF resume."
          );
        }

        if (!role) {
          role = inferRoleFromResume(resumeText);
        }

        if (mode === "offline") {
          const offlineResult = runOfflineDemoAnalysis({
            resumeText,
            role,
            location,
          });
          const atsBullets = await generateAtsBullets({
            resumeText,
            role,
            matchedSkills: offlineResult.baseline.matched_skills,
            userSkills: offlineResult.userSkills,
            missingGaps: offlineResult.baseline.missing_gaps,
          });
          return sendJson(res, 200, {
            ...offlineResult,
            resumeText,
            atsBullets,
            cacheStats: getCacheStats(),
            budgetStats: getBudgetStats(),
          });
        }

        const hasKeyAndBudget =
          Boolean((process.env.SERPAPI_KEY || "").trim()) &&
          canSpendSerpApiCredit();
        const hasCache = hasCachedJobsForQuery(role, location, limit);

        // B8: Fall back gracefully to offline demo with a clear banner when live search is unavailable
        if (!hasCache && !hasKeyAndBudget) {
          const offlineResult = runOfflineDemoAnalysis({
            resumeText,
            role,
            location,
          });
          const atsBullets = await generateAtsBullets({
            resumeText,
            role,
            matchedSkills: offlineResult.baseline.matched_skills,
            userSkills: offlineResult.userSkills,
            missingGaps: offlineResult.baseline.missing_gaps,
          });
          return sendJson(res, 200, {
            ...offlineResult,
            resumeText,
            offlineDemoNotice: `Live search unavailable for "${role}" right now. Showing labeled Demo dataset.`,
            atsBullets,
            cacheStats: getCacheStats(),
            budgetStats: getBudgetStats(),
          });
        }

        try {
          const result = await runLivePipeline({
            resumeText,
            role,
            location,
            limit,
            useCache,
            includeNews: Boolean(body.includeNews),
          });
          return sendJson(res, 200, result);
        } catch (err) {
          console.error("[server] Live pipeline fallback to demo:", err);
          if (mode === "quick") {
            const offlineResult = runOfflineDemoAnalysis({
              resumeText,
              role,
              location,
            });
            const atsBullets = await generateAtsBullets({
              resumeText,
              role,
              matchedSkills: offlineResult.baseline.matched_skills,
              userSkills: offlineResult.userSkills,
              missingGaps: offlineResult.baseline.missing_gaps,
            });
            return sendJson(res, 200, {
              ...offlineResult,
              resumeText,
              atsBullets,
              cacheStats: getCacheStats(),
              budgetStats: getBudgetStats(),
            });
          }
          throw err;
        }
      }

      if (req.method === "POST" && pathname === "/api/courses") {
        checkAndRecordRateLimit(getClientIp(req));
        const body = await readJsonBody(req);
        const rawSkill = String(body.skill || "").trim();
        const canonicalSkill = getCanonicalSkillName(rawSkill);

        // B7: Reject non-canonical arbitrary strings with 400
        if (!canonicalSkill) {
          throw new BadRequestError(
            "Invalid or unknown skill name. Choose a skill from the canonical catalog."
          );
        }

        const role = String(body.role || "Software Developer").trim();
        const { courses, reason, data_source } = await fetchCoursesForSkillWithMeta(
          canonicalSkill,
          role,
          2
        );

        return sendJson(res, 200, {
          skill: canonicalSkill,
          courses,
          reason,
          data_source,
          mini_project_idea: buildMiniProjectIdea(canonicalSkill, role),
          cacheStats: getCacheStats(),
          budgetStats: getBudgetStats(),
        });
      }

      if (req.method === "POST" && pathname === "/api/news") {
        checkAndRecordRateLimit(getClientIp(req));
        const body = await readJsonBody(req);
        const companies = Array.isArray(body.companies) ? body.companies : [];
        if (companies.length === 0) {
          throw new BadRequestError("Provide at least one company name.");
        }
        const fakeJobs = companies
          .slice(0, 4)
          .map((company) => ({ company: String(company || "").trim() }));
        const pulse = await attachCompanyPulse(fakeJobs, { maxCompanies: 4 });
        return sendJson(res, 200, {
          companyPulse: pulse,
          cacheStats: getCacheStats(),
          budgetStats: getBudgetStats(),
        });
      }

      if (req.method === "POST" && pathname === "/api/toolkit") {
        const body = await readJsonBody(req);
        const resumeText = cleanResumeText(String(body.resumeText || ""));
        const role = String(body.role || "Frontend Developer").trim();
        const location = String(body.location || CITY_OPTIONS[0]).trim();
        const mode = String(body.mode || "quick");

        if (mode !== "offline") {
          checkAndRecordRateLimit(getClientIp(req));
        }

        if (resumeText.length < 20) {
          throw new BadRequestError("Resume text is required for Career Toolkit.");
        }

        const [multiRole, localVsRemote] = await Promise.all([
          compareMultiRoleFit({
            resumeText,
            targetRole: role,
            location,
            mode,
          }),
          compareLocalVsRemote({
            resumeText,
            role,
            localCity: location,
            mode,
          }),
        ]);

        return sendJson(res, 200, {
          multiRole,
          localVsRemote,
          cacheStats: getCacheStats(),
          budgetStats: getBudgetStats(),
        });
      }

      if (req.method === "GET" || isHead) {
        return serveStaticFile(res, pathname, isHead);
      }

      res.writeHead(405);
      res.end("Method Not Allowed");
    } catch (err) {
      if (err instanceof AppError) {
        return sendJson(res, err.status, {
          error: err.message,
          code: err.code,
          ...(err.details || {}),
        });
      }
      console.error("[server] Unexpected error:", err);
      return sendJson(res, 500, {
        error: "An unexpected server error occurred. Please try again.",
        code: "INTERNAL_ERROR",
      });
    }
}

export function createAppServer() {
  loadEnv();
  return http.createServer(handleAppRequest);
}

export default handleAppRequest;

const isMainModule =
  !process.env.VERCEL &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = Number(process.env.PORT || 3000);
  const server = createAppServer();
  server.listen(port, () => {
    console.log(`SkillBridge server running at http://localhost:${port}`);
  });
}

/**
 * Hybrid Gemini + strict context-aware regex skill extraction, evidence snippets, and demand aggregation.
 * Eliminates plain-English false positives (go, r, next, spring, express, rest, sh, shell, torch, tf, iac, py, ts, elk).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";

const SKILLS_LIST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "skills_list.json"
);

const GEMINI_CACHE_MODEL = "gemini-3.5-flash-lite";
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
];
const GEMINI_TIMEOUT_MS = 12000;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Per-skill strict match rules for short or ambiguous English words.
 */
const CONTEXT_SKILL_RULES = {
  Go: [
    /(?<!\w)golang(?!\w)/i,
    /(?:[,/|•]|\b(?:skills?|languages?|stack|tech|using|with)\s*[:\-]?)\s*Go(?=$|[\s,|/;.)])/m,
    /(?<![A-Za-z])Go(?:\s*[,/|]\s*(?:Python|Java|Rust|Docker|Kubernetes|SQL|C\+\+|TypeScript|Node\.js)|(?=\s+(?:developer|engineer|microservices|services|backend)))/,
  ],
  R: [
    /(?<!\w)(?:r\s+programming|rlang|rstudio)(?!\w)/i,
    /(?:[,/|•]|\b(?:skills?|languages?|tools?)\s*[:\-]?)\s*R(?=$|[\s,|/;.)])(?!\s*&)/m,
    /(?<![A-Za-z&])R\s*[,/|]\s*(?:Python|SQL|Tableau|Pandas|SAS|Excel|Power\s*BI|Spark)(?!\w)/,
  ],
  JavaScript: [
    /(?<!\w)(?:javascript|ecmascript|es6)(?!\w)/i,
    /(?<![A-Za-z0-9_])JS(?![A-Za-z0-9_])/,
  ],
  TypeScript: [
    /(?<!\w)typescript(?!\w)/i,
    /(?:[,/|•]|\b(?:skills?|languages?)\s*[:\-]?)\s*TS(?=$|[\s,|/;.)])/m,
    /(?<![A-Za-z0-9_])TS\s*[,/|]\s*(?:JS|JavaScript|React|Node\.js|Next\.js|Angular|Vue)/,
  ],
  "REST API": [
    /(?<!\w)(?:rest\s*apis?|restful(?:\s*apis?)?)(?!\w)/i,
  ],
  "Spring Boot": [
    /(?<!\w)(?:spring\s*boot|springboot|spring\s*framework|spring\s*mvc|spring\s*data)(?!\w)/i,
  ],
  "Next.js": [
    /(?<!\w)(?:next\.js|nextjs)(?!\w)/i,
  ],
  "Express.js": [
    /(?<!\w)(?:express\.js|expressjs)(?!\w)/i,
  ],
};

function loadSkillsCatalog() {
  const rawCatalog = JSON.parse(fs.readFileSync(SKILLS_LIST_PATH, "utf8"));
  const aliasToCanonical = new Map();
  const canonicalSet = new Set();
  const compiledMatchers = [];

  for (const [canonical, aliases] of Object.entries(rawCatalog)) {
    canonicalSet.add(canonical);
    aliasToCanonical.set(canonical.toLowerCase(), canonical);

    const seen = new Set();
    const uniqueTerms = [];
    for (const term of [canonical, ...(aliases || [])]) {
      const cleaned = String(term).trim();
      const lowered = cleaned.toLowerCase();
      if (cleaned && !seen.has(lowered)) {
        seen.add(lowered);
        uniqueTerms.push(cleaned);
        aliasToCanonical.set(lowered, canonical);
      }
    }

    if (CONTEXT_SKILL_RULES[canonical]) {
      compiledMatchers.push({
        canonical,
        patterns: CONTEXT_SKILL_RULES[canonical],
      });
      continue;
    }

    uniqueTerms.sort((a, b) => b.length - a.length);
    const escaped = uniqueTerms.map(escapeRegExp).join("|");
    // Lookarounds instead of \b so symbol-containing skills (C++, C#, .NET) match accurately.
    const pattern = new RegExp(`(?<!\\w)(?:${escaped})(?!\\w)`, "i");
    compiledMatchers.push({ canonical, patterns: [pattern] });
  }

  return { rawCatalog, canonicalSet, aliasToCanonical, compiledMatchers };
}

const { rawCatalog, canonicalSet, aliasToCanonical, compiledMatchers } =
  loadSkillsCatalog();

export function isCanonicalSkill(skill) {
  return typeof skill === "string" && canonicalSet.has(skill.trim());
}

export function getCanonicalSkillName(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  return aliasToCanonical.get(cleaned.toLowerCase()) || null;
}

export function deduplicateAndNormalize(skills, { strictCanonical = false } = {}) {
  const result = [];
  const seen = new Set();

  for (const raw of skills || []) {
    if (typeof raw !== "string") continue;
    const cleaned = raw.trim();
    if (!cleaned) continue;
    const mapped = aliasToCanonical.get(cleaned.toLowerCase());
    if (strictCanonical && !mapped) continue;
    const canonical = mapped || cleaned;
    const key = canonical.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(canonical);
    }
  }
  return result;
}

export function extractSkillsRegex(text) {
  if (!text || !text.trim()) return [];
  const matched = [];
  for (const { canonical, patterns } of compiledMatchers) {
    if (patterns.some((re) => re.test(text))) {
      matched.push(canonical);
    }
  }
  return deduplicateAndNormalize(matched, { strictCanonical: true });
}

export function extractSkillEvidence(text) {
  if (!text || !text.trim()) return {};
  const evidence = {};
  const chunks = text
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const { canonical, patterns } of compiledMatchers) {
    for (const chunk of chunks) {
      if (patterns.some((re) => re.test(chunk))) {
        evidence[canonical] = chunk.length > 220 ? `${chunk.slice(0, 217)}...` : chunk;
        break;
      }
    }
  }
  return evidence;
}

function passesStrictContextIfAmbiguous(canonical, text) {
  const matcher = compiledMatchers.find((m) => m.canonical === canonical);
  if (!matcher) return false;
  if (CONTEXT_SKILL_RULES[canonical]) {
    return matcher.patterns.some((re) => re.test(text));
  }
  return true;
}

async function extractSkillsLLM(text, apiKey, fetchImpl = fetch) {
  const cacheParams = { model: `${GEMINI_CACHE_MODEL}:strict-v2`, text };
  const cached = getCached("gemini_skills", cacheParams);
  if (cached && Array.isArray(cached.skills)) {
    const filtered = cached.skills
      .map(String)
      .filter((s) => passesStrictContextIfAmbiguous(s, text));
    return deduplicateAndNormalize(filtered, { strictCanonical: true });
  }

  const canonicalNames = Object.keys(rawCatalog).join(", ");
  const prompt =
    "Extract all technical skills, programming languages, frameworks, databases, " +
    "cloud platforms, DevOps tools, and engineering concepts explicitly mentioned in " +
    "the text below.\n" +
    "You MUST map every extracted skill to its exact canonical name from this " +
    `reference taxonomy: [${canonicalNames}].\n` +
    "CRITICAL: Never treat ordinary English words (like 'go', 'spring', 'next', 'rest', " +
    "'express', 'shell', or 'R&D') as technical skills unless clearly used as technologies.\n" +
    "Return ONLY a JSON array of deduplicated canonical skill strings from the taxonomy. " +
    "Do not invent skills that are not present in the text.\n\n" +
    `Text:\n${text}`;

  let lastError = null;
  for (const modelName of GEMINI_FALLBACK_MODELS) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini HTTP ${response.status}`);
      }
      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed)) {
        throw new Error("Gemini response was not a JSON array");
      }

      const strictLlmHits = deduplicateAndNormalize(parsed.map(String), {
        strictCanonical: true,
      }).filter((skill) => passesStrictContextIfAmbiguous(skill, text));

      const strictRegexHits = extractSkillsRegex(text);
      const merged = deduplicateAndNormalize([...strictLlmHits, ...strictRegexHits], {
        strictCanonical: true,
      });

      setCached("gemini_skills", cacheParams, { skills: merged });
      return merged;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("All Gemini models failed");
}

export async function extractSkillsFromText(text, fetchImpl = fetch) {
  if (!text || !text.trim()) return [];
  loadEnv();

  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (apiKey) {
    try {
      return await extractSkillsLLM(text, apiKey, fetchImpl);
    } catch {
      // Fallback transparently to strict regex matching
    }
  }
  return extractSkillsRegex(text);
}

export async function enrichJobsWithSkills(jobs, fetchImpl = fetch) {
  if (!Array.isArray(jobs) || jobs.length === 0) return jobs || [];

  const texts = jobs.map((job) =>
    [...(job.qualifications || []), job.description || ""]
      .filter((part) => part && part.trim())
      .join("\n")
  );

  const results = new Array(jobs.length);
  const evidences = new Array(jobs.length);
  const concurrency = 5;
  for (let start = 0; start < jobs.length; start += concurrency) {
    const slice = texts.slice(start, start + concurrency);
    const batch = await Promise.all(
      slice.map((t) => extractSkillsFromText(t, fetchImpl))
    );
    batch.forEach((skills, offset) => {
      results[start + offset] = skills;
      evidences[start + offset] = extractSkillEvidence(slice[offset]);
    });
  }

  return jobs.map((job, idx) => ({
    ...job,
    extracted_skills: results[idx] || [],
    skill_evidence: evidences[idx] || {},
  }));
}

export function computeMarketDemand(jobs, { minSkills = 0 } = {}) {
  const eligibleJobs = (jobs || []).filter(
    (job) => deduplicateAndNormalize(job.extracted_skills || []).length >= minSkills
  );
  const totalJobs = eligibleJobs.length;
  if (totalJobs === 0) return [];

  const skillJobIds = new Map();
  const skillSeenJobs = new Map();

  for (const job of eligibleJobs) {
    for (const skill of deduplicateAndNormalize(job.extracted_skills || [])) {
      if (!skillJobIds.has(skill)) {
        skillJobIds.set(skill, []);
        skillSeenJobs.set(skill, new Set());
      }
      const seenSet = skillSeenJobs.get(skill);
      if (!seenSet.has(job.job_id)) {
        seenSet.add(job.job_id);
        skillJobIds.get(skill).push(job.job_id);
      }
    }
  }

  const demands = [];
  for (const [skill, jobIds] of skillJobIds.entries()) {
    demands.push({
      skill,
      job_count: jobIds.length,
      total_jobs: totalJobs,
      demand_pct: Math.round((jobIds.length / totalJobs) * 10000) / 100,
      unlocked_job_ids: jobIds,
    });
  }

  demands.sort((a, b) => {
    if (b.job_count !== a.job_count) return b.job_count - a.job_count;
    return a.skill.toLowerCase().localeCompare(b.skill.toLowerCase());
  });
  return demands;
}

export function getCanonicalSkillsCount() {
  return canonicalSet.size;
}

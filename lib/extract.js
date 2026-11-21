/**
 * SerpApi Extract API deep-read module.
 * Enriches sparse job listings (< 3 skills) by fetching apply_url markdown,
 * running skill extraction, and caching under data/cache/.
 */

import {
  canSpendSerpApiCredit,
  recordCacheHit,
  recordSerpApiCall,
} from "./budget.js";
import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";
import {
  deduplicateAndNormalize,
  extractSkillEvidence,
  extractSkillsFromText,
} from "./skills.js";

const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const EXTRACT_NAMESPACE = "extract";
const EXTRACT_TIMEOUT_MS = 15000;
const MAX_DEEP_READS_PER_SCAN = 5;

export function isValidHttpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function extractPageMarkdown(targetUrl, fetchImpl = fetch) {
  if (!isValidHttpUrl(targetUrl)) {
    return { markdown: "", fromCache: false };
  }
  loadEnv();

  const searchParams = {
    engine: "extract",
    url: targetUrl,
    output: "md",
  };

  const cached = getCached(EXTRACT_NAMESPACE, searchParams);
  if (cached && typeof cached.markdown === "string") {
    recordCacheHit();
    return { markdown: cached.markdown, fromCache: true };
  }

  const apiKey = (process.env.SERPAPI_KEY || "").trim();
  if (!apiKey || !canSpendSerpApiCredit()) {
    return { markdown: "", fromCache: false };
  }

  const reqUrl = new URL(SERPAPI_SEARCH_URL);
  for (const [k, v] of Object.entries({ ...searchParams, api_key: apiKey })) {
    reqUrl.searchParams.set(k, String(v));
  }

  try {
    recordSerpApiCall({ isDeepRead: true });
    const response = await fetchImpl(reqUrl.toString(), {
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
    });
    if (!response.ok) return { markdown: "", fromCache: false };

    const contentType = response.headers?.get?.("content-type") || "";
    let markdown = "";
    if (contentType.includes("json")) {
      const data = await response.json();
      if (!data || typeof data !== "object" || "error" in data) {
        return { markdown: "", fromCache: false };
      }
      markdown = String(data.markdown || data.md || data.text || data.content || "");
    } else {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !("error" in parsed)) {
          markdown = String(
            parsed.markdown || parsed.md || parsed.text || parsed.content || ""
          );
        }
      } catch {
        markdown = text;
      }
    }

    if (markdown.trim()) {
      setCached(EXTRACT_NAMESPACE, searchParams, { url: targetUrl, markdown });
    }
    return { markdown, fromCache: false };
  } catch {
    return { markdown: "", fromCache: false };
  }
}

export async function deepReadSparseJobs(
  jobs,
  { maxDeepReads = MAX_DEEP_READS_PER_SCAN, fetchImpl = fetch } = {}
) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { jobs: jobs || [], deepReadCount: 0 };
  }

  let attempted = 0;
  let deepReadSuccesses = 0;
  const updatedJobs = [];

  for (const job of jobs) {
    const existingSkills = Array.isArray(job.extracted_skills)
      ? job.extracted_skills
      : [];
    const shouldDeepRead =
      existingSkills.length < 3 &&
      isValidHttpUrl(job.apply_url) &&
      attempted < maxDeepReads;

    if (!shouldDeepRead) {
      updatedJobs.push({ ...job, deep_read: Boolean(job.deep_read) });
      continue;
    }

    attempted += 1;
    const { markdown } = await extractPageMarkdown(job.apply_url, fetchImpl);
    if (!markdown || !markdown.trim()) {
      updatedJobs.push({ ...job, deep_read: false });
      continue;
    }

    const pageSkills = await extractSkillsFromText(markdown, fetchImpl);
    const mergedSkills = deduplicateAndNormalize([...existingSkills, ...pageSkills], {
      strictCanonical: true,
    });
    const pageEvidence = extractSkillEvidence(markdown);
    deepReadSuccesses += 1;

    updatedJobs.push({
      ...job,
      extracted_skills: mergedSkills,
      skill_evidence: { ...pageEvidence, ...(job.skill_evidence || {}) },
      deep_read: true,
    });
  }

  return { jobs: updatedJobs, deepReadCount: deepReadSuccesses };
}

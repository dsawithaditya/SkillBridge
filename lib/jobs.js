/**
 * Live job market fetcher and parser backed by SerpApi google_jobs and disk cache.
 * Supports scan depth (10/20/30), real location handling for Remote, budget tracking, and data_source labels.
 */

import {
  canSpendSerpApiCredit,
  recordCacheHit,
  recordSerpApiCall,
} from "./budget.js";
import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";
import { UpstreamError } from "./errors.js";

const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const CACHE_NAMESPACE = "google_jobs";
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_REMOTE_LOCATION = "Bengaluru, Karnataka, India";

function extractQualifications(rawJob) {
  const highlights = Array.isArray(rawJob?.job_highlights) ? rawJob.job_highlights : [];
  const qualifications = [];
  for (const section of highlights) {
    if (section && typeof section === "object" && section.title === "Qualifications") {
      const items = Array.isArray(section.items) ? section.items : [];
      for (const item of items) {
        if (item) qualifications.push(String(item));
      }
    }
  }
  return qualifications;
}

function extractApplyUrl(rawJob) {
  const options = Array.isArray(rawJob?.apply_options) ? rawJob.apply_options : [];
  for (const opt of options) {
    if (opt && typeof opt === "object" && opt.link) {
      return String(opt.link);
    }
  }
  return null;
}

function parseJobPosting(rawJob, index, defaultLocation) {
  const ext =
    rawJob?.detected_extensions && typeof rawJob.detected_extensions === "object"
      ? rawJob.detected_extensions
      : {};
  const salaryText = ext.salary != null ? String(ext.salary) : null;
  const scheduleType = ext.schedule_type != null ? String(ext.schedule_type) : null;
  const workFromHome = Boolean(ext.work_from_home);

  const title = String(rawJob?.title || "");
  const company = String(rawJob?.company_name || "");
  const jobId = String(rawJob?.job_id || `job-${index}-${company}-${title}`);

  return {
    job_id: jobId,
    title,
    company,
    location: String(rawJob?.location || defaultLocation),
    salary_text: salaryText,
    schedule_type: scheduleType,
    work_from_home: workFromHome,
    qualifications: extractQualifications(rawJob),
    description: String(rawJob?.description || ""),
    apply_url: extractApplyUrl(rawJob),
    extracted_skills: [],
    deep_read: false,
  };
}

/**
 * Never send 'Remote' as SerpApi's location parameter (not a real place).
 * Instead keep a real geographic location and append 'remote' to query q.
 */
export function resolveSerpApiQueryAndLocation(role, location) {
  const cleanRole = String(role || "").trim();
  const cleanLoc = String(location || "").trim();
  if (!cleanLoc || cleanLoc.toLowerCase() === "remote") {
    const query = /\bremote\b/i.test(cleanRole) ? cleanRole : `${cleanRole} remote`;
    return { q: query, location: DEFAULT_REMOTE_LOCATION, isRemoteQuery: true };
  }
  return { q: cleanRole, location: cleanLoc, isRemoteQuery: false };
}

function buildJobsCacheParams(q, resolvedLocation, limit) {
  const base = {
    engine: "google_jobs",
    q,
    location: resolvedLocation,
    gl: "in",
    hl: "en",
  };
  // Keep pre-seeded 10-job cache keys untouched; include limit for 20/30 scans (U2)
  if (limit > 10) {
    return { ...base, limit };
  }
  return base;
}

export async function fetchLiveJobsWithMeta({
  role,
  location,
  limit = 10,
  useCache = true,
  ttlMs = null,
  fetchImpl = fetch,
}) {
  if (limit <= 0) {
    return { jobs: [], data_source: "cache", budgetExhausted: false };
  }
  loadEnv();

  const normalizedLimit = Math.min(30, Math.max(1, Number(limit) || 10));
  const resolved = resolveSerpApiQueryAndLocation(role, location);
  const cacheParams = buildJobsCacheParams(
    resolved.q,
    resolved.location,
    normalizedLimit
  );

  // Check exact cache key first (or fallback to 10-job key if budget/key missing)
  let payload = useCache ? getCached(CACHE_NAMESPACE, cacheParams, { ttlMs }) : null;
  let dataSource = "cache";
  let budgetExhausted = false;

  if (payload !== null) {
    recordCacheHit();
  } else {
    const apiKey = (process.env.SERPAPI_KEY || "").trim();
    const budgetOk = canSpendSerpApiCredit();

    if (!apiKey || !budgetOk) {
      budgetExhausted = Boolean(apiKey && !budgetOk);
      // Fallback to stale/base cache if available
      const fallbackBase = getCached(
        CACHE_NAMESPACE,
        buildJobsCacheParams(resolved.q, resolved.location, 10)
      );
      if (fallbackBase) {
        recordCacheHit();
        payload = fallbackBase;
        dataSource = "cache";
      } else {
        throw new UpstreamError(
          budgetExhausted
            ? "Daily live search budget reached."
            : "Live search service is not configured for this query."
        );
      }
    } else {
      const collectedJobs = [];
      let nextPageToken = null;
      let firstPayload = null;
      const maxPages = Math.min(3, Math.ceil(normalizedLimit / 10));
      const baseSerpParams = {
        engine: "google_jobs",
        q: resolved.q,
        location: resolved.location,
        gl: "in",
        hl: "en",
      };

      for (let page = 0; page < maxPages; page += 1) {
        const pageParams = nextPageToken
          ? { ...baseSerpParams, next_page_token: nextPageToken }
          : baseSerpParams;
        const url = new URL(SERPAPI_SEARCH_URL);
        for (const [k, v] of Object.entries({ ...pageParams, api_key: apiKey })) {
          url.searchParams.set(k, String(v));
        }

        let response;
        try {
          recordSerpApiCall();
          response = await fetchImpl(url.toString(), {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        } catch (err) {
          console.error("[jobs] Upstream fetch error:", err);
          const stale = getCached(CACHE_NAMESPACE, cacheParams);
          if (stale && page === 0) {
            recordCacheHit();
            payload = stale;
            dataSource = "cache";
            break;
          }
          throw new UpstreamError("Live job search timed out or could not connect.");
        }

        if (!response.ok) {
          console.error(`[jobs] Upstream HTTP ${response.status}`);
          throw new UpstreamError(`Live job search returned status ${response.status}.`);
        }

        const pageData = await response.json();
        if (!pageData || typeof pageData !== "object" || Array.isArray(pageData)) {
          break;
        }
        if ("error" in pageData) {
          console.error("[jobs] SerpApi error:", pageData.error);
          throw new UpstreamError(`Live search provider error: ${pageData.error}`);
        }

        if (page === 0) firstPayload = pageData;
        const pageJobs = Array.isArray(pageData.jobs_results)
          ? pageData.jobs_results
          : [];
        collectedJobs.push(...pageJobs);

        nextPageToken = pageData?.serpapi_pagination?.next_page_token || null;
        if (!nextPageToken || collectedJobs.length >= normalizedLimit) break;
      }

      if (!payload && firstPayload) {
        dataSource = "live";
        payload =
          collectedJobs.length > (firstPayload.jobs_results?.length || 0)
            ? { ...firstPayload, jobs_results: collectedJobs }
            : firstPayload;
        setCached(CACHE_NAMESPACE, cacheParams, payload);
      }
    }
  }

  const rawJobs = Array.isArray(payload?.jobs_results) ? payload.jobs_results : [];
  const jobs = rawJobs
    .slice(0, normalizedLimit)
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => parseJobPosting(item, idx, resolved.location));

  return { jobs, data_source: dataSource, budgetExhausted };
}

export async function fetchLiveJobs(options) {
  const { jobs } = await fetchLiveJobsWithMeta(options);
  return jobs;
}

export function hasCachedJobsForQuery(role, location, limit = 10) {
  const resolved = resolveSerpApiQueryAndLocation(role, location);
  const exact = getCached(
    CACHE_NAMESPACE,
    buildJobsCacheParams(resolved.q, resolved.location, limit)
  );
  if (exact !== null) return true;
  // Also allow base 10-job cache hit check
  return (
    getCached(CACHE_NAMESPACE, buildJobsCacheParams(resolved.q, resolved.location, 10)) !==
    null
  );
}

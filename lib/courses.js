/**
 * Learning resource fetcher (SerpApi YouTube + Google Search official docs fallback),
 * explicit empty-reason reporting (U1), weekend mini-projects, and 4-week study planner.
 */

import {
  canSpendSerpApiCredit,
  recordCacheHit,
  recordSerpApiCall,
} from "./budget.js";
import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";

const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const YT_CACHE_NAMESPACE = "youtube";
const GOOGLE_CACHE_NAMESPACE = "google_docs";
const REQUEST_TIMEOUT_MS = 15000;

function parseDurationSeconds(lengthStr) {
  if (!lengthStr || typeof lengthStr !== "string") return null;
  const parts = lengthStr
    .trim()
    .split(":")
    .map((n) => Number(n));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function extractYoutubeResource(item) {
  const title = String(item?.title || "").trim();
  const link = String(item?.link || "").trim();
  if (!title || !link) return null;

  const rawChannel = item?.channel;
  let channelName = "YouTube";
  if (rawChannel && typeof rawChannel === "object") {
    channelName = String(rawChannel.name || "YouTube");
  } else if (typeof rawChannel === "string" && rawChannel.trim()) {
    channelName = rawChannel.trim();
  }

  let duration = null;
  if (item?.length) {
    duration = String(item.length);
  } else if (item?.video_count) {
    duration = `${item.video_count} videos`;
  }

  const rawThumb = item?.thumbnail;
  let thumbnail = null;
  if (rawThumb && typeof rawThumb === "object") {
    thumbnail = rawThumb.static || rawThumb.rich || null;
  } else if (typeof rawThumb === "string" && rawThumb.trim()) {
    thumbnail = rawThumb.trim();
  }

  const views = typeof item?.views === "number" ? item.views : null;

  return {
    title,
    url: link,
    source: "YouTube",
    channel_or_site: channelName,
    duration,
    duration_seconds: parseDurationSeconds(duration),
    views,
    is_free: true,
    thumbnail,
  };
}

function extractGoogleOrganicResource(item) {
  const title = String(item?.title || "").trim();
  const link = String(item?.link || "").trim();
  if (!title || !link) return null;

  let siteName = String(item?.source || "").trim();
  if (!siteName) {
    try {
      siteName = new URL(link).hostname.replace(/^www\./, "");
    } catch {
      siteName = "Official Docs";
    }
  }

  return {
    title,
    url: link,
    source: "Google Search",
    channel_or_site: siteName,
    duration: "Docs & Guide",
    duration_seconds: null,
    views: null,
    is_free: true,
    thumbnail: null,
  };
}

export async function fetchGoogleDocsFallback(
  skill,
  role,
  maxResults = 2,
  fetchImpl = fetch
) {
  const searchParams = {
    engine: "google",
    q: `${skill} official documentation tutorial for ${role}`,
    gl: "in",
    hl: "en",
  };

  let payload = getCached(GOOGLE_CACHE_NAMESPACE, searchParams);
  let dataSource = "cache";

  if (payload !== null) {
    recordCacheHit();
  } else {
    const apiKey = (process.env.SERPAPI_KEY || "").trim();
    if (!apiKey) return { courses: [], reason: "no_api_key", data_source: "none" };
    if (!canSpendSerpApiCredit()) {
      return { courses: [], reason: "budget_reached", data_source: "none" };
    }

    const url = new URL(SERPAPI_SEARCH_URL);
    for (const [k, v] of Object.entries({ ...searchParams, api_key: apiKey })) {
      url.searchParams.set(k, String(v));
    }

    try {
      recordSerpApiCall();
      const response = await fetchImpl(url.toString(), {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          courses: [],
          reason: response.status === 429 ? "rate_limited" : "no_results",
          data_source: "none",
        };
      }
      const data = await response.json();
      if (!data || typeof data !== "object" || "error" in data) {
        return { courses: [], reason: "no_results", data_source: "none" };
      }
      payload = data;
      dataSource = "live";
      setCached(GOOGLE_CACHE_NAMESPACE, searchParams, payload);
    } catch {
      return { courses: [], reason: "no_results", data_source: "none" };
    }
  }

  const organic = Array.isArray(payload?.organic_results)
    ? payload.organic_results
    : [];
  const resources = [];
  for (const item of organic) {
    if (!item || typeof item !== "object") continue;
    const parsed = extractGoogleOrganicResource(item);
    if (parsed) resources.push(parsed);
    if (resources.length >= maxResults) break;
  }
  return {
    courses: resources,
    reason: resources.length > 0 ? "ok" : "no_results",
    data_source: dataSource,
  };
}

export async function fetchCoursesForSkillWithMeta(
  skill,
  role,
  maxResults = 2,
  fetchImpl = fetch
) {
  loadEnv();
  const searchParams = {
    engine: "youtube",
    search_query: `${skill} full course tutorial for ${role}`,
    gl: "in",
    hl: "en",
  };

  let payload = getCached(YT_CACHE_NAMESPACE, searchParams);
  let dataSource = "cache";
  let failureReason = null;

  if (payload !== null) {
    recordCacheHit();
  } else {
    const apiKey = (process.env.SERPAPI_KEY || "").trim();
    if (!apiKey) {
      failureReason = "no_api_key";
    } else if (!canSpendSerpApiCredit()) {
      failureReason = "budget_reached";
    } else {
      const url = new URL(SERPAPI_SEARCH_URL);
      for (const [k, v] of Object.entries({ ...searchParams, api_key: apiKey })) {
        url.searchParams.set(k, String(v));
      }

      try {
        recordSerpApiCall();
        const response = await fetchImpl(url.toString(), {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.status === 429) {
          failureReason = "rate_limited";
        } else if (response.ok) {
          const data = await response.json();
          if (data && typeof data === "object" && !("error" in data)) {
            payload = data;
            dataSource = "live";
            setCached(YT_CACHE_NAMESPACE, searchParams, payload);
          } else {
            failureReason = "no_results";
          }
        } else {
          failureReason = "no_results";
        }
      } catch {
        failureReason = "no_results";
      }
    }
  }

  const resources = [];
  if (payload) {
    const candidates = [...(payload.video_results || [])];
    if (candidates.length < maxResults) {
      candidates.push(...(payload.playlist_results || []));
    }

    for (const item of candidates) {
      if (!item || typeof item !== "object") continue;
      const parsed = extractYoutubeResource(item);
      if (parsed) resources.push(parsed);
    }

    // Rank free YouTube courses cleanly by views + structured length presence
    resources.sort((a, b) => {
      const aLen = a.duration_seconds ? 1 : 0;
      const bLen = b.duration_seconds ? 1 : 0;
      if (bLen !== aLen) return bLen - aLen;
      return (b.views || 0) - (a.views || 0);
    });
  }

  const sliced = resources.slice(0, maxResults);
  if (sliced.length > 0) {
    return { courses: sliced, reason: "ok", data_source: dataSource };
  }

  // Fallback to Google Search official documentation if YouTube returned 0
  if (failureReason === null || failureReason === "no_results") {
    const docsRes = await fetchGoogleDocsFallback(
      skill,
      role,
      maxResults,
      fetchImpl
    );
    if (docsRes.courses.length > 0) {
      return docsRes;
    }
    if (docsRes.reason && failureReason === null) {
      failureReason = docsRes.reason;
    }
  }

  return {
    courses: [],
    reason: failureReason || "no_results",
    data_source: "none",
  };
}

export async function fetchCoursesForSkill(
  skill,
  role,
  maxResults = 2,
  fetchImpl = fetch
) {
  const { courses } = await fetchCoursesForSkillWithMeta(
    skill,
    role,
    maxResults,
    fetchImpl
  );
  return courses;
}

export function buildMiniProjectIdea(skill, role) {
  const templates = {
    docker:
      `Containerize a realistic ${role} service using a multi-stage Dockerfile and Docker ` +
      `Compose setup with a local datastore. Publish the repo with one-command startup ` +
      `and healthcheck verification to prove production-ready Docker skills.`,
    kubernetes:
      `Deploy a containerized ${role} application onto a local Kubernetes cluster (Minikube ` +
      `or kind) with Deployment, Service, and readiness probe manifests. Document scaling ` +
      `and rolling-update tests in your GitHub README as hands-on Kubernetes proof.`,
    postgresql:
      `Design a normalized PostgreSQL schema with migrations and composite indexes for a ` +
      `core ${role} workflow. Share sample queries with EXPLAIN ANALYZE benchmarks in your ` +
      `repository to demonstrate practical PostgreSQL tuning.`,
    redis:
      `Integrate Redis caching and rate-limiting into a ${role} API to speed up repeated ` +
      `reads and protect hot endpoints. Include before-and-after latency benchmarks in your ` +
      `README to showcase measurable Redis impact.`,
    aws:
      `Build and deploy a small ${role} workload on AWS using free-tier services such as ` +
      `S3, Lambda, or EC2 with least-privilege IAM policies. Add an architecture diagram ` +
      `and reproducible setup steps to prove real AWS deployment experience.`,
    "ci/cd":
      `Set up a GitHub Actions CI/CD pipeline for a ${role} project that runs linting, ` +
      `unit tests, and automated build checks on every pull request. Add status badges and ` +
      `a sample failing-to-passing PR log to demonstrate reliable CI/CD automation.`,
    typescript:
      `Refactor a ${role} module into strict TypeScript with typed API contracts, discriminated ` +
      `unions, and zero 'any' types. Ship a GitHub repo with tsc type-check CI to prove type-safe engineering.`,
    fastapi:
      `Build an async FastAPI service for a ${role} use case featuring Pydantic v2 validation, ` +
      `OpenAPI docs, and dependency-injected database sessions. Include pytest async endpoint tests in your README.`,
    "next.js":
      `Create a responsive ${role} web app in Next.js using server-rendered routes, dynamic metadata, ` +
      `and API route handlers. Deploy a live preview link and document Lighthouse performance scores.`,
    "power bi":
      `Build an interactive Power BI executive dashboard for a ${role} dataset using DAX calculated ` +
      `measures, star-schema modeling, and drill-through filters. Publish screenshots and your .pbix data model notes on GitHub.`,
    jest:
      `Add a Jest unit and integration test suite covering edge cases, mocks, and high branch coverage ` +
      `for a ${role} codebase. Include coverage badges and test output logs in your repository.`,
    cypress:
      `Write end-to-end Cypress browser tests for a ${role} application covering critical user flows, ` +
      `network intercepts, and form validations. Commit a headless CI test video or screenshot artifact to GitHub.`,
    playwright:
      `Automate cross-browser end-to-end tests with Playwright for a ${role} web app including trace-viewer ` +
      `artifacts and API mocking. Document how to run the suite headlessly in a single command.`,
    microservices:
      `Split a monolithic ${role} workflow into two decoupled microservices communicating via REST or message ` +
      `events with independent healthchecks. Document service boundaries and failure recovery in your README.`,
    llm:
      `Build a domain-specific ${role} assistant powered by structured LLM JSON outputs, prompt guardrails, ` +
      `and deterministic fallback logic. Benchmark accuracy and latency across test cases in your repo.`,
  };

  return (
    templates[skill.toLowerCase()] ||
    `Build a focused ${role} weekend project centered on ${skill} that solves one real ` +
      `workflow end to end with clean sample data. Publish it on GitHub with automated checks ` +
      `and a concise README showing how ${skill} improves the solution.`
  );
}

/**
 * Build a 4-week study & portfolio roadmap from the top 3 missing gaps.
 */
export function buildFourWeekPlan(gapsWithCourses, role) {
  const top3 = (gapsWithCourses || []).slice(0, 3);
  if (top3.length === 0) return [];

  const weeks = top3.map((gap, idx) => ({
    week: idx + 1,
    focusSkill: gap.skill,
    title: `Week ${idx + 1}: Master ${gap.skill}`,
    goal:
      gap.net_ready_unlocked > 0
        ? `Makes +${gap.net_ready_unlocked} more job(s) ready immediately`
        : `Required in ${gap.jobs_unlocked} scanned ${role} openings`,
    resources: (gap.courses || []).slice(0, 2),
    deliverable: gap.mini_project_idea || buildMiniProjectIdea(gap.skill, role),
  }));

  weeks.push({
    week: 4,
    focusSkill: top3.map((g) => g.skill).join(" + "),
    title: `Week 4: Integrated Capstone & Applications`,
    goal: `Combine ${top3.map((g) => g.skill).join(", ")} into one deployed ${role} showcase`,
    resources: [],
    deliverable: `Merge your Week 1–3 mini-projects into a clean portfolio repo, update your resume bullets with real metrics, and apply directly to all Ready Today openings.`,
  });

  return weeks;
}

export async function attachLearningResources(
  gaps,
  role,
  topN = 4,
  fetchImpl = fetch
) {
  loadEnv();
  const cutoff = Math.max(0, topN);

  return Promise.all(
    (gaps || []).map(async (gap, idx) => {
      const miniProject = gap.mini_project_idea || buildMiniProjectIdea(gap.skill, role);
      if (idx >= cutoff) {
        return {
          ...gap,
          courses: Array.isArray(gap.courses) ? gap.courses : [],
          course_reason: "not_preloaded",
          mini_project_idea: miniProject,
        };
      }
      const { courses, reason, data_source } = await fetchCoursesForSkillWithMeta(
        gap.skill,
        role,
        2,
        fetchImpl
      );
      return {
        ...gap,
        courses,
        course_reason: reason,
        course_source: data_source,
        mini_project_idea: miniProject,
      };
    })
  );
}

/**
 * In-memory per-IP rate limiter, daily SerpApi credit budget, and request telemetry.
 */

import { RateLimitError } from "./errors.js";

const DEFAULT_RATE_LIMIT_PER_MIN = 10;
const RATE_WINDOW_MS = 60 * 1000;

const ipBuckets = new Map();
let budgetDayKey = getUtcDayKey();
let dailySerpApiCalls = 0;
let dailyCacheHits = 0;
let dailyDeepReads = 0;

function getUtcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function rollBudgetDayIfNeeded() {
  const today = getUtcDayKey();
  if (today !== budgetDayKey) {
    budgetDayKey = today;
    dailySerpApiCalls = 0;
    dailyCacheHits = 0;
    dailyDeepReads = 0;
  }
}

export function getRateLimitMax() {
  const raw = Number(process.env.RATE_LIMIT_PER_MIN);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RATE_LIMIT_PER_MIN;
}

export function checkAndRecordRateLimit(ipAddress = "127.0.0.1") {
  const key = String(ipAddress || "127.0.0.1");
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const maxReqs = getRateLimitMax();

  const existing = ipBuckets.get(key) || [];
  const recent = existing.filter((ts) => ts > cutoff);

  if (recent.length >= maxReqs) {
    ipBuckets.set(key, recent);
    throw new RateLimitError(
      `Rate limit reached (${maxReqs} requests/minute). Please wait briefly before retrying.`
    );
  }

  recent.push(now);
  ipBuckets.set(key, recent);
}

export function resetRateLimits() {
  ipBuckets.clear();
}

export function getDailySerpApiBudget() {
  const raw = Number(process.env.SERPAPI_DAILY_BUDGET);
  if (process.env.SERPAPI_DAILY_BUDGET !== undefined && process.env.SERPAPI_DAILY_BUDGET !== "") {
    return Number.isFinite(raw) && raw >= 0 ? raw : 100;
  }
  return 100;
}

export function canSpendSerpApiCredit() {
  rollBudgetDayIfNeeded();
  return dailySerpApiCalls < getDailySerpApiBudget();
}

export function recordSerpApiCall({ isDeepRead = false } = {}) {
  rollBudgetDayIfNeeded();
  dailySerpApiCalls += 1;
  if (isDeepRead) dailyDeepReads += 1;
}

export function recordCacheHit() {
  rollBudgetDayIfNeeded();
  dailyCacheHits += 1;
}

export function getBudgetStats() {
  rollBudgetDayIfNeeded();
  const limit = getDailySerpApiBudget();
  return {
    day: budgetDayKey,
    dailySerpApiCalls,
    dailyCacheHits,
    dailyDeepReads,
    dailyBudget: limit,
    budgetRemaining: Math.max(0, limit - dailySerpApiCalls),
    budgetExhausted: dailySerpApiCalls >= limit,
  };
}

export function resetBudgetStats() {
  budgetDayKey = getUtcDayKey();
  dailySerpApiCalls = 0;
  dailyCacheHits = 0;
  dailyDeepReads = 0;
}

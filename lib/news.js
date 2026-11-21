/**
 * SerpApi Google News Company Pulse module.
 * Fetches recent news headlines for hiring companies and tags risk/opportunity signals.
 */

import {
  canSpendSerpApiCredit,
  recordCacheHit,
  recordSerpApiCall,
} from "./budget.js";
import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";

const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const NEWS_NAMESPACE = "google_news";
const NEWS_TIMEOUT_MS = 12000;

const RISK_RE =
  /\b(layoff|layoffs|job cuts?|downsizing|restructuring|lawsuit|probe|breach|bankrupt|loss|freeze|shutting)\b/i;
const OPPORTUNITY_RE =
  /\b(funding|raises|raised|series [a-f]|launch|launches|launched|expands|expansion|hiring|partnership|growth|ipo|acquires|profit|award)\b/i;

export function classifyHeadlineSentiment(title) {
  if (RISK_RE.test(title || "")) return "Risk";
  if (OPPORTUNITY_RE.test(title || "")) return "Opportunity";
  return "Neutral";
}

export async function fetchCompanyNews(company, fetchImpl = fetch) {
  const cleanCompany = String(company || "").trim();
  if (!cleanCompany) return { headlines: [], data_source: "none" };
  loadEnv();

  const searchParams = {
    engine: "google_news",
    q: cleanCompany,
    gl: "in",
    hl: "en",
  };

  let payload = getCached(NEWS_NAMESPACE, searchParams);
  let dataSource = "cache";

  if (payload !== null) {
    recordCacheHit();
  } else {
    const apiKey = (process.env.SERPAPI_KEY || "").trim();
    if (!apiKey || !canSpendSerpApiCredit()) {
      return { headlines: [], data_source: "none" };
    }

    const url = new URL(SERPAPI_SEARCH_URL);
    for (const [k, v] of Object.entries({ ...searchParams, api_key: apiKey })) {
      url.searchParams.set(k, String(v));
    }

    try {
      recordSerpApiCall();
      const response = await fetchImpl(url.toString(), {
        signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
      });
      if (!response.ok) return { headlines: [], data_source: "none" };
      const data = await response.json();
      if (!data || typeof data !== "object" || "error" in data) {
        return { headlines: [], data_source: "none" };
      }
      payload = data;
      dataSource = "live";
      setCached(NEWS_NAMESPACE, searchParams, payload);
    } catch {
      return { headlines: [], data_source: "none" };
    }
  }

  const rawNews = Array.isArray(payload?.news_results) ? payload.news_results : [];
  const headlines = [];
  for (const item of rawNews.slice(0, 2)) {
    if (!item || typeof item !== "object" || !item.title || !item.link) continue;
    const title = String(item.title).trim();
    headlines.push({
      title,
      link: String(item.link),
      source: String(item?.source?.name || "Google News"),
      date: item.date ? String(item.date) : null,
      sentiment: classifyHeadlineSentiment(title),
    });
  }

  return { headlines, data_source: dataSource };
}

export async function attachCompanyPulse(jobs, { maxCompanies = 4, fetchImpl = fetch } = {}) {
  const uniqueCompanies = [];
  const seen = new Set();
  for (const job of jobs || []) {
    const name = String(job.company || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    uniqueCompanies.push(name);
    if (uniqueCompanies.length >= maxCompanies) break;
  }

  const pulseByCompany = {};
  await Promise.all(
    uniqueCompanies.map(async (company) => {
      const res = await fetchCompanyNews(company, fetchImpl);
      if (res.headlines.length > 0) {
        pulseByCompany[company] = res;
      }
    })
  );
  return pulseByCompany;
}

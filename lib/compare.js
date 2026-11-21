/**
 * Career Toolkit engines:
 * 1. Multi-Role Fit Comparison (U4: dynamic target role + 2 adjacent roles; B6: explicit data_source)
 * 2. Local City vs. Remote Market Comparison (B6: real location + 'remote' query; never fake 'Remote' location)
 * 3. Honest ATS Resume Bullet Rewriter (B3: zero hardcoded percentages, verified skills only, separate 'After you learn it')
 */

import { canSpendSerpApiCredit } from "./budget.js";
import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";
import { fetchLiveJobsWithMeta, hasCachedJobsForQuery } from "./jobs.js";
import { buildOfflineDemoJobs } from "./offlineDemo.js";
import {
  computeMarketDemand,
  enrichJobsWithSkills,
  extractSkillsFromText,
  extractSkillsRegex,
} from "./skills.js";
import { analyzeSkillGaps } from "../public/js/gap.js";

const ADJACENT_ROLE_MAP = [
  {
    re: /\b(front[\s-]?end|react|angular|vue|ui)\b/i,
    adjacent: ["Full Stack Developer", "React Developer"],
  },
  {
    re: /\b(back[\s-]?end|python|django|flask|fastapi|api)\b/i,
    adjacent: ["Full Stack Developer", "Cloud Backend Engineer"],
  },
  {
    re: /\b(data\s+analyst|analytics|bi\s+analyst|tableau|power\s*bi)\b/i,
    adjacent: ["Business Analyst", "Analytics Engineer"],
  },
  {
    re: /\b(devops|sre|cloud|platform|kubernetes|infrastructure)\b/i,
    adjacent: ["Cloud Platform Engineer", "Site Reliability Engineer"],
  },
  {
    re: /\b(ml|machine\s+learning|ai\s+engineer|data\s+scientist|llm)\b/i,
    adjacent: ["AI Engineer", "Data Engineer"],
  },
  {
    re: /\b(mobile|android|ios|flutter|react\s+native)\b/i,
    adjacent: ["React Native Developer", "Frontend Developer"],
  },
  {
    re: /\b(security|appsec|cyber)\b/i,
    adjacent: ["Cloud Security Engineer", "DevSecOps Engineer"],
  },
];

export function getAdjacentRoles(targetRole) {
  const cleanRole = String(targetRole || "").trim() || "Software Developer";
  for (const entry of ADJACENT_ROLE_MAP) {
    if (entry.re.test(cleanRole)) {
      const filtered = entry.adjacent.filter(
        (r) => r.toLowerCase() !== cleanRole.toLowerCase()
      );
      if (filtered.length >= 2) return [cleanRole, filtered[0], filtered[1]];
    }
  }
  const defaults = [
    "Frontend Developer",
    "Backend Python Developer",
    "Data Analyst",
  ].filter((r) => r.toLowerCase() !== cleanRole.toLowerCase());
  return [cleanRole, defaults[0], defaults[1]];
}

async function getJobsForRoleAndLocation({
  role,
  location,
  mode = "quick",
  fetchImpl = fetch,
}) {
  if (mode === "offline") {
    return { jobs: buildOfflineDemoJobs(role, location), data_source: "demo" };
  }

  const hasApiKey = Boolean((process.env.SERPAPI_KEY || "").trim());
  const cached = hasCachedJobsForQuery(role, location);

  if (!cached && (!hasApiKey || !canSpendSerpApiCredit())) {
    return { jobs: buildOfflineDemoJobs(role, location), data_source: "demo" };
  }

  try {
    const { jobs, data_source } = await fetchLiveJobsWithMeta({
      role,
      location,
      limit: 10,
      useCache: true,
      fetchImpl,
    });
    const enriched = await enrichJobsWithSkills(jobs, fetchImpl);
    return { jobs: enriched, data_source };
  } catch {
    return { jobs: buildOfflineDemoJobs(role, location), data_source: "demo" };
  }
}

export async function compareMultiRoleFit({
  resumeText,
  targetRole = "Frontend Developer",
  location,
  roles = null,
  mode = "quick",
  fetchImpl = fetch,
}) {
  const userSkills =
    mode === "offline"
      ? extractSkillsRegex(resumeText)
      : await extractSkillsFromText(resumeText, fetchImpl);

  const selectedRoles =
    Array.isArray(roles) && roles.length > 0
      ? roles
      : getAdjacentRoles(targetRole);
  const uniqueRoles = [
    ...new Set(selectedRoles.map((r) => String(r).trim()).filter(Boolean)),
  ];

  // Ensure targetRole is always included
  if (
    targetRole &&
    !uniqueRoles.some((r) => r.toLowerCase() === targetRole.trim().toLowerCase())
  ) {
    uniqueRoles.unshift(targetRole.trim());
  }

  const evaluations = await Promise.all(
    uniqueRoles.slice(0, 3).map(async (roleName) => {
      const { jobs, data_source } = await getJobsForRoleAndLocation({
        role: roleName,
        location,
        mode,
        fetchImpl,
      });
      const demandList = computeMarketDemand(jobs, { minSkills: 3 });
      const analysis = analyzeSkillGaps({
        role: roleName,
        location,
        userSkills,
        jobs,
        demandList,
      });
      return {
        role: roleName,
        location,
        data_source,
        is_target_role:
          roleName.toLowerCase() === String(targetRole || "").trim().toLowerCase(),
        readiness_score: analysis.readiness_score,
        jobs_scanned: jobs.length,
        ready_jobs_count: analysis.ready_jobs.length,
        almost_ready_count: analysis.almost_ready_jobs.length,
        matched_skills: analysis.matched_skills,
        top_gaps: analysis.missing_gaps.slice(0, 3).map((g) => ({
          skill: g.skill,
          jobs_unlocked: g.jobs_unlocked,
          net_ready_unlocked: g.net_ready_unlocked,
          demand_pct: g.demand_pct,
        })),
      };
    })
  );

  evaluations.sort((a, b) => b.readiness_score - a.readiness_score);
  const bestFit = evaluations[0] || null;

  return {
    best_fit_role: bestFit ? bestFit.role : null,
    best_fit_score: bestFit ? bestFit.readiness_score : 0,
    evaluations,
  };
}

export async function compareLocalVsRemote({
  resumeText,
  role,
  localCity,
  mode = "quick",
  fetchImpl = fetch,
}) {
  const effectiveLocal =
    localCity && localCity.toLowerCase() !== "remote"
      ? localCity
      : "Bengaluru, Karnataka, India";

  const userSkills =
    mode === "offline"
      ? extractSkillsRegex(resumeText)
      : await extractSkillsFromText(resumeText, fetchImpl);

  // Remote search keeps real geographic location and appends 'remote' to query (never fake location='Remote')
  const remoteQuery = /\bremote\b/i.test(role) ? role : `${role} remote`;

  const [localRes, remoteRes] = await Promise.all([
    getJobsForRoleAndLocation({
      role,
      location: effectiveLocal,
      mode,
      fetchImpl,
    }),
    getJobsForRoleAndLocation({
      role: remoteQuery,
      location: effectiveLocal,
      mode,
      fetchImpl,
    }),
  ]);

  const localDemand = computeMarketDemand(localRes.jobs, { minSkills: 3 });
  const remoteDemand = computeMarketDemand(remoteRes.jobs, { minSkills: 3 });

  const localAnalysis = analyzeSkillGaps({
    role,
    location: effectiveLocal,
    userSkills,
    jobs: localRes.jobs,
    demandList: localDemand,
  });
  const remoteAnalysis = analyzeSkillGaps({
    role: remoteQuery,
    location: effectiveLocal,
    userSkills,
    jobs: remoteRes.jobs,
    demandList: remoteDemand,
  });

  return {
    local: {
      location: effectiveLocal,
      data_source: localRes.data_source,
      readiness_score: localAnalysis.readiness_score,
      ready_jobs_count: localAnalysis.ready_jobs.length,
      top_skills: localDemand.slice(0, 5),
      top_gap: localAnalysis.missing_gaps[0]?.skill || "All Covered",
    },
    remote: {
      location: `${effectiveLocal} (Remote filter)`,
      data_source: remoteRes.data_source,
      readiness_score: remoteAnalysis.readiness_score,
      ready_jobs_count: remoteAnalysis.ready_jobs.length,
      top_skills: remoteDemand.slice(0, 5),
      top_gap: remoteAnalysis.missing_gaps[0]?.skill || "All Covered",
    },
  };
}

/**
 * Honest ATS Resume Bullet Rewriter (B3):
 * - Zero hardcoded percentages (never invents metrics).
 * - Uses ONLY verified resume skills; returns no bullets + guidance when 0 skills matched.
 * - Places unlearned market skills into a separate 'After you learn it' list with [X%] placeholders.
 */
export async function generateAtsBullets({
  resumeText,
  role,
  matchedSkills = [],
  userSkills = [],
  missingGaps = [],
  fetchImpl = fetch,
}) {
  loadEnv();
  const verifiedSkills = [
    ...new Set([...(matchedSkills || []), ...(userSkills || [])].filter(Boolean)),
  ];

  if (verifiedSkills.length === 0) {
    return {
      label: "Templates: edit with your real facts",
      verifiedBullets: [],
      afterYouLearnBullets: [],
      guidance:
        "No verified technical skills were detected on your resume yet. Start with one of your top missing skill gaps below, build the Weekend Proof-of-Work project, and add those tools honestly to your resume.",
    };
  }

  const topVerified = verifiedSkills.slice(0, 4);
  const topMissing = (missingGaps || [])
    .slice(0, 2)
    .map((g) => (typeof g === "string" ? g : g.skill))
    .filter(Boolean);

  const cacheParams = {
    version: "honest-v2",
    role,
    verified: topVerified,
    missing: topMissing,
    resumeSnippet: (resumeText || "").slice(0, 350),
  };

  const cached = getCached("gemini_ats_bullets", cacheParams);
  if (
    cached &&
    Array.isArray(cached.verifiedBullets) &&
    cached.verifiedBullets.length > 0
  ) {
    return {
      label: "Templates: edit with your real facts",
      verifiedBullets: cached.verifiedBullets,
      afterYouLearnBullets: cached.afterYouLearnBullets || [],
      guidance: null,
    };
  }

  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (apiKey) {
    try {
      const prompt =
        `Create honest, ATS-friendly resume bullet templates for a candidate targeting "${role}".\n` +
        `STRICT RULES:\n` +
        `1. In "verifiedBullets" (2 items): ONLY reference these verified resume skills: [${topVerified.join(", ")}]. NEVER mention unlearned skills.\n` +
        `2. In "afterYouLearnBullets" (1–2 items): write future templates for [${topMissing.join(", ")}] to add ONLY after completing a project.\n` +
        `3. NEVER invent percentages, numbers, company names, or tools. Always use explicit placeholders like [X%], [N users], and [project name].\n` +
        `Return ONLY JSON matching {"verifiedBullets": string[], "afterYouLearnBullets": string[]}.\n\n` +
        `Resume context:\n${(resumeText || "").slice(0, 700)}`;

      const endpoint =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          Array.isArray(parsed.verifiedBullets) &&
          parsed.verifiedBullets.length > 0
        ) {
          const out = {
            label: "Templates: edit with your real facts",
            verifiedBullets: parsed.verifiedBullets.slice(0, 3).map(String),
            afterYouLearnBullets: Array.isArray(parsed.afterYouLearnBullets)
              ? parsed.afterYouLearnBullets.slice(0, 2).map(String)
              : [],
            guidance: null,
          };
          setCached("gemini_ats_bullets", cacheParams, out);
          return out;
        }
      }
    } catch {
      // Fallback to deterministic honest templates with placeholders
    }
  }

  const s1 = topVerified[0];
  const s2 = topVerified[1] || topVerified[0];
  const verifiedBullets = [
    `Built and maintained [project name] for ${role} workflows using ${s1}${s2 !== s1 ? ` and ${s2}` : ""}, improving reliability across [N users/requests] by [X%].`,
    `Implemented core features with ${topVerified.slice(0, 3).join(", ")} in [project name], cutting manual effort by [X hours/week] during [team/internship].`,
  ];

  const afterYouLearnBullets = topMissing.map(
    (skill) =>
      `[After you learn ${skill}] Built [project name] integrating ${skill} with ${s1}, reducing [bottleneck] by [X%] with verified test coverage.`
  );

  return {
    label: "Templates: edit with your real facts",
    verifiedBullets,
    afterYouLearnBullets,
    guidance: null,
  };
}

/**
 * Shared ROI gap ranking, job readiness classification, salary lift, and What-If simulation engine.
 * Pure ESM with zero Node/DOM dependencies so both server and browser share identical math.
 *
 * B2: Requires >= 1 matched skill AND excludes sparse (< 3 skills) jobs into low_data_jobs.
 * B5: Ranks missing gaps by net_ready_unlocked first, then jobs_unlocked (demand count).
 */

const MIN_SKILLS_FOR_ANALYSIS = 3;

function computeJobCoverage(jobSkillsSet, effectiveSkillsSet) {
  if (jobSkillsSet.size === 0) {
    return { matchedCount: 0, coverage: 0, missingCount: 0 };
  }
  let matchedCount = 0;
  for (const skill of jobSkillsSet) {
    if (effectiveSkillsSet.has(skill)) {
      matchedCount += 1;
    }
  }
  const missingCount = jobSkillsSet.size - matchedCount;
  return {
    matchedCount,
    coverage: matchedCount / jobSkillsSet.size,
    missingCount,
  };
}

export function isJobReady(matchedCount, coverage, missingCount) {
  return matchedCount >= 1 && (coverage >= 0.75 || missingCount <= 1);
}

function countMarginalReadyUnlocks(eligibleJobs, effectiveSkillsSet, candidateSkill) {
  const augmented = new Set(effectiveSkillsSet);
  augmented.add(candidateSkill);
  let newlyReady = 0;

  for (const job of eligibleJobs) {
    const jobSkills = new Set(job.extracted_skills || []);
    if (jobSkills.size < MIN_SKILLS_FOR_ANALYSIS || !jobSkills.has(candidateSkill)) {
      continue;
    }

    const before = computeJobCoverage(jobSkills, effectiveSkillsSet);
    if (isJobReady(before.matchedCount, before.coverage, before.missingCount)) {
      continue;
    }

    const after = computeJobCoverage(jobSkills, augmented);
    if (isJobReady(after.matchedCount, after.coverage, after.missingCount)) {
      newlyReady += 1;
    }
  }
  return newlyReady;
}

/**
 * Parse salary strings (e.g. "12L - 18L", "6 - 9 LPA", "₹8,00,000 - ₹12,00,000", "$90k - $120k")
 * into a comparable annual INR-equivalent midpoint when unambiguous.
 */
export function parseSalaryMidpoint(salaryText) {
  if (!salaryText || typeof salaryText !== "string") return null;
  const text = salaryText.trim();
  if (!text) return null;

  const isMonthly = /(?:\b|\/)(month|mo|pm)\b/i.test(text);
  const isLpa = /(?:\b|\d)(lpa|lakhs?|l)\b/i.test(text);
  const isThousand = /(?:\b|\d)k\b/i.test(text);

  const matches = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)/g)].map((m) =>
    Number(m[1].replace(/,/g, ""))
  );
  if (matches.length === 0) return null;

  const nums = matches.slice(0, 2).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return null;

  let mid = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (isLpa && mid < 200) {
    mid *= 100000;
  } else if (isThousand && mid < 1000) {
    mid *= 1000;
  }
  if (isMonthly) {
    mid *= 12;
  }

  return mid >= 50000 ? Math.round(mid) : null;
}

function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function computeSalaryLift(eligibleJobs, skill) {
  const withSkill = [];
  const withoutSkill = [];

  for (const job of eligibleJobs) {
    const pay = parseSalaryMidpoint(job.salary_text);
    if (pay === null) continue;
    const skills = new Set(job.extracted_skills || []);
    if (skills.has(skill)) withSkill.push(pay);
    else withoutSkill.push(pay);
  }

  const totalWithSalary = withSkill.length + withoutSkill.length;
  if (totalWithSalary < 5 || withSkill.length === 0 || withoutSkill.length === 0) {
    return null;
  }

  const medianWith = median(withSkill);
  const medianWithout = median(withoutSkill);
  if (!medianWith || !medianWithout) return null;

  const liftPct = Math.round(((medianWith - medianWithout) / medianWithout) * 100);
  return {
    median_with: medianWith,
    median_without: medianWithout,
    lift_pct: liftPct,
    sample_size: totalWithSalary,
  };
}

function computeEligibleDemand(eligibleJobs, fallbackDemandList) {
  if (eligibleJobs.length === 0) {
    return [];
  }

  const totalJobs = eligibleJobs.length;
  const skillJobIds = new Map();
  const skillSeen = new Map();

  for (const job of eligibleJobs) {
    for (const skill of job.extracted_skills || []) {
      if (!skillJobIds.has(skill)) {
        skillJobIds.set(skill, []);
        skillSeen.set(skill, new Set());
      }
      if (!skillSeen.get(skill).has(job.job_id)) {
        skillSeen.get(skill).add(job.job_id);
        skillJobIds.get(skill).push(job.job_id);
      }
    }
  }

  const trendLookup = new Map();
  for (const d of fallbackDemandList || []) {
    if (d.trend) {
      trendLookup.set(d.skill, { trend: d.trend, trend_delta: d.trend_delta || 0 });
    }
  }

  const demands = [];
  for (const [skill, jobIds] of skillJobIds.entries()) {
    const trendInfo = trendLookup.get(skill) || {};
    demands.push({
      skill,
      job_count: jobIds.length,
      total_jobs: totalJobs,
      demand_pct: Math.round((jobIds.length / totalJobs) * 1000) / 10,
      unlocked_job_ids: jobIds,
      ...(trendInfo.trend ? trendInfo : {}),
    });
  }

  demands.sort((a, b) => {
    if (b.job_count !== a.job_count) return b.job_count - a.job_count;
    return a.skill.toLowerCase().localeCompare(b.skill.toLowerCase());
  });
  return demands;
}

function buildMissingGaps(eligibleDemand, effectiveSkillsSet, eligibleJobs) {
  const missingDemands = (eligibleDemand || []).filter(
    (d) => !effectiveSkillsSet.has(d.skill)
  );

  const scored = missingDemands.map((demand) => {
    const requiredCount =
      Array.isArray(demand.unlocked_job_ids) && demand.unlocked_job_ids.length > 0
        ? demand.unlocked_job_ids.length
        : Number(demand.job_count || 0);
    const netReadyUnlocked = countMarginalReadyUnlocks(
      eligibleJobs,
      effectiveSkillsSet,
      demand.skill
    );
    const salaryLift = computeSalaryLift(eligibleJobs, demand.skill);
    return {
      skill: demand.skill,
      jobs_unlocked: requiredCount,
      net_ready_unlocked: netReadyUnlocked,
      demand_pct: Math.round(Number(demand.demand_pct || 0) * 10) / 10,
      trend: demand.trend || "flat",
      trend_delta: demand.trend_delta || 0,
      salary_lift: salaryLift,
    };
  });

  // B5: Rank by net_ready_unlocked FIRST, then demand count (jobs_unlocked), then demand_pct
  scored.sort((a, b) => {
    if (b.net_ready_unlocked !== a.net_ready_unlocked) {
      return b.net_ready_unlocked - a.net_ready_unlocked;
    }
    if (b.jobs_unlocked !== a.jobs_unlocked) return b.jobs_unlocked - a.jobs_unlocked;
    if (b.demand_pct !== a.demand_pct) return b.demand_pct - a.demand_pct;
    return a.skill.localeCompare(b.skill);
  });

  return scored.map((item, idx) => ({
    ...item,
    priority_rank: idx + 1,
    courses: [],
    mini_project_idea: "",
  }));
}

export function analyzeSkillGaps({
  role,
  location,
  userSkills = [],
  jobs = [],
  demandList = [],
  simulatedSkills = [],
}) {
  const effectiveSkills = new Set([...(userSkills || []), ...(simulatedSkills || [])]);

  const eligibleJobs = [];
  const lowDataJobs = [];

  for (const job of jobs || []) {
    const jobSkills = new Set(job.extracted_skills || []);
    if (jobSkills.size < MIN_SKILLS_FOR_ANALYSIS) {
      lowDataJobs.push(job);
    } else {
      eligibleJobs.push(job);
    }
  }

  // Same denominator for demand_pct and readiness_score (eligibleJobs with >= 3 skills)
  const effectiveDemand = computeEligibleDemand(eligibleJobs, demandList);
  const demandSkills = effectiveDemand.map((d) => d.skill);

  const matchedSkills = demandSkills.filter((s) => effectiveSkills.has(s));
  const matchedSet = new Set(matchedSkills);
  const allEligibleSkills = new Set();
  for (const job of eligibleJobs) {
    for (const s of job.extracted_skills || []) allEligibleSkills.add(s);
  }
  const extraMatched = [...effectiveSkills]
    .filter((s) => allEligibleSkills.has(s) && !matchedSet.has(s))
    .sort();
  matchedSkills.push(...extraMatched);

  const missingGaps = buildMissingGaps(effectiveDemand, effectiveSkills, eligibleJobs);

  const readyCandidates = [];
  const almostCandidates = [];
  const coverages = [];

  eligibleJobs.forEach((job, idx) => {
    const jobSkills = new Set(job.extracted_skills || []);
    const { matchedCount, coverage, missingCount } = computeJobCoverage(
      jobSkills,
      effectiveSkills
    );
    coverages.push(coverage);

    if (isJobReady(matchedCount, coverage, missingCount)) {
      readyCandidates.push({ coverage, missingCount, idx, job });
    } else if (missingCount >= 2 && missingCount <= 3) {
      almostCandidates.push({ coverage, missingCount, idx, job });
    }
  });

  readyCandidates.sort(
    (a, b) =>
      b.coverage - a.coverage || a.missingCount - b.missingCount || a.idx - b.idx
  );
  almostCandidates.sort(
    (a, b) =>
      a.missingCount - b.missingCount || b.coverage - a.coverage || a.idx - b.idx
  );

  let rawScore = 0;
  if (coverages.length > 0 && effectiveSkills.size > 0) {
    rawScore = (coverages.reduce((sum, c) => sum + c, 0) / coverages.length) * 100;
  }

  const readinessScore = Math.round(Math.max(0, Math.min(100, rawScore)) * 10) / 10;

  return {
    role,
    location,
    readiness_score: readinessScore,
    eligible_jobs_count: eligibleJobs.length,
    matched_skills: matchedSkills,
    missing_gaps: missingGaps,
    ready_jobs: readyCandidates.map((item) => item.job),
    almost_ready_jobs: almostCandidates.map((item) => item.job),
    low_data_jobs: lowDataJobs,
    demand_list: effectiveDemand,
  };
}

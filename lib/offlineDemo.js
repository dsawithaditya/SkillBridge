/**
 * Deterministic 0-credit offline job fixtures with word-boundary routing (B9).
 */

import { buildFourWeekPlan, buildMiniProjectIdea } from "./courses.js";
import {
  computeMarketDemand,
  extractSkillEvidence,
  extractSkillsRegex,
} from "./skills.js";
import { analyzeSkillGaps } from "../public/js/gap.js";

export const CITY_OPTIONS = [
  "Bengaluru, Karnataka, India",
  "Mumbai, Maharashtra, India",
  "Remote",
];

// Word-boundary matchers prevent substring bugs ('mobile' -> 'bi', 'build'/'guitar' -> 'ui')
const FRONTEND_RE =
  /\b(front[\s-]?end|react|reactjs|next\.js|nextjs|angular|vue|ui\/ux|web\s+dev(?:eloper|elopment)?)\b/i;
const DATA_RE =
  /\b(data\s+analyst|data\s+analytics|business\s+analyst|bi\s+analyst|data\s+science|data\s+scientist|analytics\s+engineer)\b/i;
const BACKEND_RE =
  /\b(back[\s-]?end|python|django|flask|fastapi)\b/i;

function offlineFrontendSpecs(loc) {
  return [
    {
      job_id: "demo-fe-1",
      title: "Junior Frontend Developer (React)",
      company: "FinStack Labs",
      location: loc,
      salary_text: "6 - 9 LPA",
      skills: ["React", "JavaScript", "HTML", "CSS", "Tailwind CSS", "Git"],
      description:
        "Build responsive web interfaces using React, JavaScript, HTML5, CSS3, Tailwind CSS, and Git pull-request workflows.",
    },
    {
      job_id: "demo-fe-2",
      title: "Frontend Engineer — Web Platform",
      company: "PayPulse India",
      location: loc,
      salary_text: "8 - 12 LPA",
      skills: ["React", "JavaScript", "HTML", "CSS", "REST API", "TypeScript"],
      description:
        "Develop dashboard modules with React, TypeScript, JavaScript, HTML, CSS, and REST API integrations.",
    },
    {
      job_id: "demo-fe-3",
      title: "UI Developer (React & Next.js)",
      company: "CartFlow Commerce",
      location: loc,
      salary_text: "9 - 14 LPA",
      skills: ["React", "TypeScript", "JavaScript", "HTML", "CSS", "Next.js", "Tailwind CSS"],
      description:
        "Ship fast storefront pages using React, Next.js, TypeScript, JavaScript, HTML, CSS, and Tailwind CSS.",
    },
    {
      job_id: "demo-fe-4",
      title: "Frontend Product Engineer",
      company: "CloudMetrics AI",
      location: loc,
      salary_text: "10 - 15 LPA",
      skills: ["React", "TypeScript", "Next.js", "Tailwind CSS", "Jest", "Git"],
      description:
        "Own interactive analytics UIs in React, Next.js, TypeScript, and Tailwind CSS with unit testing in Jest and version control via Git.",
    },
    {
      job_id: "demo-fe-5",
      title: "React Software Engineer",
      company: "HealthGrid Digital",
      location: loc,
      salary_text: "8 - 13 LPA",
      skills: ["React", "JavaScript", "TypeScript", "GraphQL", "Jest", "CSS"],
      description:
        "Implement patient portals with React, TypeScript, JavaScript, CSS, GraphQL queries, and automated Jest test suites.",
    },
    {
      job_id: "demo-fe-6",
      title: "Full-Cycle Frontend Engineer",
      company: "ScaleOps Tech",
      location: "Remote",
      work_from_home: true,
      salary_text: "12 - 18 LPA",
      skills: ["React", "TypeScript", "Next.js", "GraphQL", "Docker", "CI/CD"],
      description:
        "Build SSR applications with React, Next.js, TypeScript, GraphQL, containerized via Docker with CI/CD pipelines.",
    },
    {
      job_id: "demo-fe-7",
      title: "Frontend Automation & UI Engineer",
      company: "VelocityPay",
      location: loc,
      salary_text: "10 - 16 LPA",
      skills: ["React", "TypeScript", "Jest", "Playwright", "CI/CD", "AWS"],
      description:
        "Maintain checkout experiences in React and TypeScript backed by Jest, Playwright end-to-end tests, CI/CD, and AWS hosting.",
    },
  ];
}

function offlineBackendSpecs(loc) {
  return [
    {
      job_id: "demo-be-1",
      title: "Backend Python Developer",
      company: "FinLedger Tech",
      location: loc,
      salary_text: "7 - 11 LPA",
      skills: ["Python", "Django", "PostgreSQL", "REST API", "Git", "Linux"],
      description:
        "Design scalable REST API services in Python and Django backed by PostgreSQL on Linux using Git code reviews.",
    },
    {
      job_id: "demo-be-2",
      title: "Python API Engineer",
      company: "LedgerFlow Systems",
      location: loc,
      salary_text: "8 - 12 LPA",
      skills: ["Python", "Flask", "PostgreSQL", "SQL", "REST API", "Docker"],
      description:
        "Build reliable Flask REST API microservices in Python with SQL, PostgreSQL, and Docker containers.",
    },
    {
      job_id: "demo-be-3",
      title: "Software Engineer — Python Backend",
      company: "QuickShip Logistics",
      location: loc,
      salary_text: "10 - 15 LPA",
      skills: ["Python", "FastAPI", "PostgreSQL", "Docker", "REST API", "Git"],
      description:
        "Develop high-throughput FastAPI REST API endpoints in Python with PostgreSQL, Docker, and Git.",
    },
    {
      job_id: "demo-be-4",
      title: "Backend Engineer (Django & Caching)",
      company: "RetailStack India",
      location: loc,
      salary_text: "9 - 14 LPA",
      skills: ["Python", "Django", "PostgreSQL", "Docker", "Redis", "Pytest"],
      description:
        "Scale e-commerce backends using Python, Django, PostgreSQL, Redis caching, Docker, and Pytest integration tests.",
    },
    {
      job_id: "demo-be-5",
      title: "Junior Platform Engineer (Python)",
      company: "SignalCore Analytics",
      location: "Remote",
      work_from_home: true,
      salary_text: "9 - 13 LPA",
      skills: ["Python", "FastAPI", "PostgreSQL", "Redis", "Docker", "Linux"],
      description:
        "Build low-latency FastAPI services in Python using PostgreSQL, Redis, Docker, and Linux deployments.",
    },
    {
      job_id: "demo-be-6",
      title: "Cloud Backend Developer (Python)",
      company: "NexaCloud Labs",
      location: loc,
      salary_text: "12 - 18 LPA",
      skills: ["Python", "FastAPI", "Docker", "Kubernetes", "AWS", "CI/CD"],
      description:
        "Operate Python and FastAPI services packaged in Docker on Kubernetes and AWS with automated CI/CD workflows.",
    },
    {
      job_id: "demo-be-7",
      title: "Senior-Track Python Engineer",
      company: "CredPulse",
      location: loc,
      salary_text: "11 - 17 LPA",
      skills: ["Python", "Django", "Docker", "Redis", "AWS", "Pytest", "CI/CD"],
      description:
        "Deliver resilient Python and Django services with Redis, Docker, AWS, Pytest coverage, and CI/CD automation.",
    },
  ];
}

function offlineDataAnalystSpecs(loc) {
  return [
    {
      job_id: "demo-da-1",
      title: "Junior Data Analyst",
      company: "MetricPulse Retail",
      location: loc,
      salary_text: "6 - 9 LPA",
      skills: ["Python", "SQL", "Pandas", "Excel", "Tableau"],
      description:
        "Analyze business KPIs using SQL, Python, Pandas, Excel models, and Tableau executive dashboards.",
    },
    {
      job_id: "demo-da-2",
      title: "Business & Product Analyst",
      company: "FinServe Insights",
      location: loc,
      salary_text: "7 - 10 LPA",
      skills: ["Python", "SQL", "Pandas", "NumPy", "Power BI"],
      description:
        "Explore funnel conversion cohorts with Python, Pandas, NumPy, SQL, and Power BI reporting.",
    },
    {
      job_id: "demo-da-3",
      title: "BI & Revenue Data Analyst",
      company: "ShopWave India",
      location: loc,
      salary_text: "8 - 12 LPA",
      skills: ["SQL", "Python", "Tableau", "Power BI", "ETL"],
      description:
        "Maintain automated ETL reporting pipelines using SQL and Python feeding Tableau and Power BI dashboards.",
    },
    {
      job_id: "demo-da-4",
      title: "Product Analytics Specialist",
      company: "UrbanFleet",
      location: loc,
      salary_text: "8 - 13 LPA",
      skills: ["Python", "SQL", "Pandas", "Power BI", "PostgreSQL", "Git"],
      description:
        "Write PostgreSQL and SQL queries, build Python Pandas notebooks, track code in Git, and publish Power BI scorecards.",
    },
    {
      job_id: "demo-da-5",
      title: "Analytics Engineer / Analyst",
      company: "DataNest Studio",
      location: "Remote",
      work_from_home: true,
      salary_text: "9 - 14 LPA",
      skills: ["SQL", "Excel", "Tableau", "BigQuery", "ETL", "dbt"],
      description:
        "Transform warehouse tables in BigQuery with SQL, dbt, and ETL workflows for Tableau and Excel stakeholders.",
    },
    {
      job_id: "demo-da-6",
      title: "Data Platform Analyst",
      company: "StreamLine Media",
      location: loc,
      salary_text: "10 - 16 LPA",
      skills: ["Python", "SQL", "Apache Spark", "ETL", "AWS", "Apache Airflow"],
      description:
        "Build large-scale ETL jobs in Python, SQL, and Apache Spark orchestrated by Apache Airflow on AWS.",
    },
    {
      job_id: "demo-da-7",
      title: "Cloud BI Analyst",
      company: "ScaleKart",
      location: loc,
      salary_text: "10 - 15 LPA",
      skills: ["SQL", "Power BI", "Snowflake", "dbt", "Python", "AWS"],
      description:
        "Model Snowflake datasets with SQL, dbt, and Python to power AWS-backed Power BI reporting.",
    },
  ];
}

export function resolveOfflineDataset(role) {
  const cleanRole = String(role || "").trim();
  if (FRONTEND_RE.test(cleanRole)) {
    return { datasetKey: "frontend", exactMatch: true, label: "Frontend Developer" };
  }
  if (DATA_RE.test(cleanRole)) {
    return { datasetKey: "data_analyst", exactMatch: true, label: "Data Analyst" };
  }
  if (BACKEND_RE.test(cleanRole)) {
    return { datasetKey: "backend", exactMatch: true, label: "Backend Python" };
  }
  return { datasetKey: "backend", exactMatch: false, label: "Backend Python" };
}

export function buildOfflineDemoJobs(role, location) {
  const effectiveLocation = (location || "").trim() || CITY_OPTIONS[0];
  const { datasetKey } = resolveOfflineDataset(role);

  let specs;
  if (datasetKey === "frontend") {
    specs = offlineFrontendSpecs(effectiveLocation);
  } else if (datasetKey === "data_analyst") {
    specs = offlineDataAnalystSpecs(effectiveLocation);
  } else {
    specs = offlineBackendSpecs(effectiveLocation);
  }

  return specs.map((spec) => {
    const qualLine = `Hands-on experience with ${spec.skills.join(", ")}.`;
    const combined = `${qualLine}\n${spec.description}`;
    const extracted = extractSkillsRegex(combined);
    const evidence = extractSkillEvidence(combined);
    return {
      job_id: spec.job_id,
      title: spec.title,
      company: spec.company,
      location: spec.location,
      salary_text: spec.salary_text,
      work_from_home: Boolean(spec.work_from_home),
      qualifications: [qualLine],
      description: spec.description,
      apply_url: null,
      extracted_skills: extracted.length > 0 ? extracted : [...spec.skills],
      skill_evidence: evidence,
      deep_read: false,
    };
  });
}

export function runOfflineDemoAnalysis({ resumeText, role, location }) {
  const userSkills = extractSkillsRegex(resumeText);
  const resumeEvidence = extractSkillEvidence(resumeText);
  const routing = resolveOfflineDataset(role);
  const jobs = buildOfflineDemoJobs(role, location);
  const demandList = computeMarketDemand(jobs, { minSkills: 3 });

  const baseline = analyzeSkillGaps({
    role,
    location,
    userSkills,
    jobs,
    demandList,
  });

  const coursesBySkill = {};
  const gapsWithProjects = baseline.missing_gaps.map((gap) => {
    const item = {
      ...gap,
      courses: [],
      course_reason: "offline_demo",
      mini_project_idea: buildMiniProjectIdea(gap.skill, role),
    };
    coursesBySkill[gap.skill] = item;
    return item;
  });

  const notice = routing.exactMatch
    ? `Demo Dataset (${routing.label}) active for ${role} in ${location} — 0 API credits consumed.`
    : `No offline dataset for '${role}'. Showing the closest demo: ${routing.label}.`;

  return {
    role,
    location,
    data_source: "demo",
    analysisMode: "offline_demo",
    offlineDemoNotice: notice,
    userSkills,
    resumeEvidence,
    jobs,
    demandList,
    baseline,
    coursesBySkill,
    fourWeekPlan: buildFourWeekPlan(gapsWithProjects, role),
    deepReadCount: 0,
    companyPulse: {},
  };
}

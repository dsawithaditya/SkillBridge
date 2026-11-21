# SkillBridge — Live Skill-Gap & Career Navigator

> Upload your resume. Scan live local job openings. Simulate closing the gap and get an ROI-ranked 4-week learning plan.

**Built for:** Beyond 9TO5 Buildathon — Track 1: Best Use of SerpApi  
**Live Demo:** _[Add your deployed Render / Railway URL here]_  
**Demo Preview:** _[Add hero screenshot or 60s demo GIF in `docs/` here]_

---

## Why SerpApi Powers Every Step

Without real-time search data from SerpApi, SkillBridge cannot exist—live search decides **what** to learn, **where** companies are hiring, and **how** to prove it:

| SerpApi Engine | Role in SkillBridge | Module |
| :--- | :--- | :--- |
| **`google_jobs`** | Pulls live openings, `job_highlights.Qualifications`, salary tags, and `apply_options` | [lib/jobs.js](lib/jobs.js) |
| **`extract`** | Deep-reads sparse job application pages (`< 3` skills) into Markdown (`output=md`) | [lib/extract.js](lib/extract.js) |
| **`youtube`** | Fetches free full courses & playlists ranked by duration/views for top gaps | [lib/courses.js](lib/courses.js) |
| **`google`** | Falls back to official docs & hands-on guides when YouTube returns 0 results | [lib/courses.js](lib/courses.js) |
| **`google_news`** | Powers **Company Pulse** headlines tagged for Growth/Opportunity vs. Risk | [lib/news.js](lib/news.js) |

---

## Architecture

```text
Resume (PDF via unpdf / Paste / 3 Quick Presets)
        │
        ▼
[lib/skills.js]  ──► Gemini Flash (x-goog-api-key) + strict context regex (no false English hits)
        │
        ▼
[lib/jobs.js]    ──► SerpApi google_jobs (10/20/30 scan depth + SHA-256 disk cache)
        │
        ▼
[lib/extract.js] ──► SerpApi Extract API deep-read for sparse (<3 skill) listings
        │
        ▼
[public/js/gap.js] ──► Marginal ROI Ranking (net_ready_unlocked), Salary Lift & Low-Data Bucket
        │
        ├──► [lib/courses.js]  ──► YouTube + Google Search Docs + 4-Week Portfolio Plan
        ├──► [lib/news.js]     ──► Google News Company Pulse
        └──► [lib/compare.js]  ──► Target + Adjacent Multi-Role Fit, Local vs. Remote, Honest ATS Templates
```

---

## Quickstart (3 Commands)

```bash
npm install
cp .env.example .env    # Optional: add SERPAPI_KEY & GEMINI_API_KEY (Offline + Seeded Cache work with 0 keys)
npm start               # Open http://localhost:3000
```

Run tests offline (0 API credits consumed):

```bash
npm test
```

---

## 2-Minute Demo Script

1. **Hook (15s):** *"Aarav has 6 skills and 0 interviews. Students spend months guessing what to learn instead of checking what local teams hire for right now."*
2. **Live/Cached Scan (30s):** Click **Frontend** (CS Final-Year Student) in the sidebar. Point to the header telemetry (`SerpApi calls` / `Cache hits` / `Data Source: Cache` or `Live`) and click any skill bar to inspect the **exact sentence evidence** in the scraped postings.
3. **The "Aha!" Moment (30s):** Toggle **TypeScript** in the **What-If Simulator**. Watch Readiness Score jump in 0ms and see the exact newly unlocked jobs flip into **Ready to Apply Today**.
4. **Deep-Read + Company Pulse + Education (30s):** Show **Deep-read** badges from SerpApi `engine=extract`, click **Load Company News** (`engine=google_news`), and open the **4-Week Study Plan** + YouTube/Docs resources.
5. **Close (15s):** *"Every recommendation is grounded in live search across 5 SerpApi engines, protected by per-IP rate limits and disk caching."*

---

## Team & License

| Name | Role |
| :--- | :--- |
| Aditya Kumar | Full-Stack & AI Developer |

Licensed under the [MIT License](LICENSE).

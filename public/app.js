import { analyzeSkillGaps } from "/js/gap.js";

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const VALID_PAGES = new Set(["setup", "overview", "roadmap", "jobs", "demand", "toolkit"]);

const state = {
  presets: [],
  cities: [],
  activePage: "setup",
  activeResult: null,
  toolkitData: null,
  simulatedSkills: new Set(),
  openRoadmapSkills: new Set(),
  demandStatusFilter: "All",
  jobFilterQuery: "",
  onlyUnlocked: false,
  selectedPdfBase64: null,
};

const els = {
  navLinks: document.querySelectorAll(".sb-nav-link"),
  pages: document.querySelectorAll(".sb-page"),
  gotoButtons: document.querySelectorAll("[data-goto]"),
  quickStudentBtn: document.getElementById("quickStudentBtn"),
  quickBackendBtn: document.getElementById("quickBackendBtn"),
  quickAnalystBtn: document.getElementById("quickAnalystBtn"),
  sourceRadios: document.querySelectorAll('input[name="resumeSource"]'),
  presetPanel: document.getElementById("presetInputPanel"),
  presetPreviewWrap: document.getElementById("presetPreviewWrap"),
  pdfPanel: document.getElementById("pdfInputPanel"),
  pastePanel: document.getElementById("pasteInputPanel"),
  personaSelect: document.getElementById("personaSelect"),
  presetPreview: document.getElementById("presetPreview"),
  pdfFileInput: document.getElementById("pdfFileInput"),
  pdfFileName: document.getElementById("pdfFileName"),
  pastedResumeInput: document.getElementById("pastedResumeInput"),
  targetRoleInput: document.getElementById("targetRoleInput"),
  citySelect: document.getElementById("citySelect"),
  scanDepthSelect: document.getElementById("scanDepthSelect"),
  analyzeLiveBtn: document.getElementById("analyzeLiveBtn"),
  loadOfflineBtn: document.getElementById("loadOfflineBtn"),
  cacheStatsBadge: document.getElementById("cacheStatsBadge"),
  sidebarSkillsSection: document.getElementById("sidebarSkillsSection"),
  sidebarSkillsPills: document.getElementById("sidebarSkillsPills"),
  modeChip: document.getElementById("modeChip"),
  telemetryChip: document.getElementById("telemetryChip"),
  errorBanner: document.getElementById("errorBanner"),
  loadingBanner: document.getElementById("loadingBanner"),
  loadingText: document.getElementById("loadingText"),
  offlineNotice: document.getElementById("offlineNotice"),
  sampleWarning: document.getElementById("sampleWarning"),
  onboardingView: document.getElementById("onboardingView"),
  dashboardView: document.getElementById("dashboardView"),
  metricReadiness: document.getElementById("metricReadiness"),
  metricReadinessDelta: document.getElementById("metricReadinessDelta"),
  metricJobsScanned: document.getElementById("metricJobsScanned"),
  metricJobsMeta: document.getElementById("metricJobsMeta"),
  metricReadyCount: document.getElementById("metricReadyCount"),
  metricReadyDelta: document.getElementById("metricReadyDelta"),
  metricTopRoi: document.getElementById("metricTopRoi"),
  metricTopRoiSub: document.getElementById("metricTopRoiSub"),
  progressLabel: document.getElementById("progressLabel"),
  progressValue: document.getElementById("progressValue"),
  progressBase: document.getElementById("progressBase"),
  progressSim: document.getElementById("progressSim"),
  printPlanBtn: document.getElementById("printPlanBtn"),
  shareLinkBtn: document.getElementById("shareLinkBtn"),
  simulatorPanel: document.getElementById("simulatorPanel"),
  simTop3Btn: document.getElementById("simTop3Btn"),
  simResetBtn: document.getElementById("simResetBtn"),
  simulatorCheckboxes: document.getElementById("simulatorCheckboxes"),
  simActiveBanner: document.getElementById("simActiveBanner"),
  evidenceDrawer: document.getElementById("evidenceDrawer"),
  evidenceTitle: document.getElementById("evidenceTitle"),
  evidenceSubtitle: document.getElementById("evidenceSubtitle"),
  evidenceList: document.getElementById("evidenceList"),
  closeEvidenceBtn: document.getElementById("closeEvidenceBtn"),
  tabs: document.querySelectorAll(".sb-tab"),
  tabPanels: document.querySelectorAll(".sb-tab-panel"),
  gapsSourceBadge: document.getElementById("gapsSourceBadge"),
  gapChartContainer: document.getElementById("gapChartContainer"),
  snapshotMeta: document.getElementById("snapshotMeta"),
  snapshotMatched: document.getElementById("snapshotMatched"),
  snapshotSimGroup: document.getElementById("snapshotSimGroup"),
  snapshotSimulated: document.getElementById("snapshotSimulated"),
  snapshotMissing: document.getElementById("snapshotMissing"),
  fourWeekPlanGrid: document.getElementById("fourWeekPlanGrid"),
  learningRoadmap: document.getElementById("learningRoadmap"),
  jobFilterInput: document.getElementById("jobFilterInput"),
  onlyUnlockedWrap: document.getElementById("onlyUnlockedWrap"),
  onlyUnlockedToggle: document.getElementById("onlyUnlockedToggle"),
  loadCompanyNewsBtn: document.getElementById("loadCompanyNewsBtn"),
  jobsSourceBadge: document.getElementById("jobsSourceBadge"),
  readyBucketTitle: document.getElementById("readyBucketTitle"),
  almostBucketTitle: document.getElementById("almostBucketTitle"),
  readyJobsList: document.getElementById("readyJobsList"),
  almostJobsList: document.getElementById("almostJobsList"),
  lowDataSection: document.getElementById("lowDataSection"),
  lowDataTitle: document.getElementById("lowDataTitle"),
  lowDataJobsList: document.getElementById("lowDataJobsList"),
  filterBtns: document.querySelectorAll(".sb-filter-btn"),
  downloadCsvBtn: document.getElementById("downloadCsvBtn"),
  rawDemandTbody: document.getElementById("rawDemandTbody"),
  atsTitle: document.getElementById("atsTitle"),
  atsGuidanceBox: document.getElementById("atsGuidanceBox"),
  atsVerifiedSection: document.getElementById("atsVerifiedSection"),
  atsFutureSection: document.getElementById("atsFutureSection"),
  atsBulletsList: document.getElementById("atsBulletsList"),
  atsFutureList: document.getElementById("atsFutureList"),
  copyBulletsBtn: document.getElementById("copyBulletsBtn"),
  runToolkitBtn: document.getElementById("runToolkitBtn"),
  toolkitResultsWrap: document.getElementById("toolkitResultsWrap"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * S1: Allow ONLY http:// or https:// external links (prevents javascript: or data: injection).
 */
function sanitizeHttpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

function renderSourceBadgeHtml(source) {
  const clean = String(source || "cache").toLowerCase();
  const label = clean === "live" ? "Live" : clean === "demo" ? "Demo" : "Cache";
  const cls =
    clean === "live"
      ? "sb-source-live"
      : clean === "demo"
      ? "sb-source-demo"
      : "sb-source-cache";
  return `<span class="sb-source-badge ${cls}">${label}</span>`;
}

function applySourceBadge(el, source) {
  if (!el) return;
  const clean = String(source || "cache").toLowerCase();
  el.textContent = clean === "live" ? "Live" : clean === "demo" ? "Demo" : "Cache";
  el.className = `sb-source-badge ${
    clean === "live"
      ? "sb-source-live"
      : clean === "demo"
      ? "sb-source-demo"
      : "sb-source-cache"
  }`;
}

function updateCacheBadge(cacheStats) {
  if (!cacheStats || typeof cacheStats.totalFiles !== "number") return;
  els.cacheStatsBadge.textContent = `Cache: ${cacheStats.totalFiles}`;
}

function renderPillsHtml(skills, variant = "matched", { clickableResume = false } = {}) {
  if (!skills || skills.length === 0) return "";
  const cls =
    variant === "missing"
      ? "sb-pill sb-pill-missing"
      : variant === "sim"
      ? "sb-pill sb-pill-sim"
      : "sb-pill sb-pill-matched";
  return skills
    .map((s) =>
      clickableResume
        ? `<button type="button" class="${cls} sb-pill-btn" data-resume-skill="${escapeHtml(s)}">${escapeHtml(s)}</button>`
        : `<span class="${cls}">${escapeHtml(s)}</span>`
    )
    .join("");
}

function formatCourseReason(reason) {
  const map = {
    no_api_key: "Tutorials could not be loaded live (search key unavailable on this server).",
    rate_limited: "Rate limit reached for tutorial lookups. Please wait a minute and retry.",
    budget_reached: "Daily live search budget reached; showing cached/offline guidance only.",
    no_results: "No matching tutorials or documentation found for this skill.",
    offline_demo: "Offline Demo mode active (0 live requests made).",
    not_preloaded: "Outside the top 4 preloaded skills to save credits — click below to load.",
  };
  return map[reason] || "No tutorials loaded yet — click below to search YouTube & Official Docs.";
}

function navigateTo(pageId, updateHash = true) {
  const target = VALID_PAGES.has(pageId) ? pageId : "setup";
  const resolved = target !== "setup" && !state.activeResult ? "setup" : target;
  state.activePage = resolved;

  els.pages.forEach((p) => p.classList.toggle("active", p.id === `page-${resolved}`));
  els.navLinks.forEach((btn) => {
    const pName = btn.getAttribute("data-page");
    btn.classList.toggle("active", pName === resolved);
    if (pName !== "setup") {
      btn.disabled = !state.activeResult;
    }
  });

  if (updateHash && window.location.hash !== `#${resolved}`) {
    history.replaceState(null, "", `#${resolved}`);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getSelectedSource() {
  for (const r of els.sourceRadios) {
    if (r.checked) return r.value;
  }
  return "preset";
}

function setSelectedSource(source) {
  for (const r of els.sourceRadios) {
    r.checked = r.value === source;
  }
  els.presetPanel.classList.toggle("hidden", source !== "preset");
  if (els.presetPreviewWrap) {
    els.presetPreviewWrap.classList.toggle("hidden", source !== "preset");
  }
  els.pdfPanel.classList.toggle("hidden", source !== "pdf");
  els.pastePanel.classList.toggle("hidden", source !== "paste");
}

function showError(msg) {
  els.errorBanner.textContent = msg;
  els.errorBanner.classList.toggle("hidden", !msg);
}

function setLoading(isLoading, message = "Scanning live job market & extracting skills...") {
  els.loadingText.textContent = message;
  els.loadingBanner.classList.toggle("hidden", !isLoading);
  els.analyzeLiveBtn.disabled = isLoading;
  els.loadOfflineBtn.disabled = isLoading;
  els.quickStudentBtn.disabled = isLoading;
  els.quickBackendBtn.disabled = isLoading;
  if (els.quickAnalystBtn) els.quickAnalystBtn.disabled = isLoading;
}

function applySelectedPreset(index) {
  const preset = state.presets[index];
  if (!preset) return;
  els.personaSelect.value = String(index);
  els.presetPreview.textContent = preset.text;
  els.targetRoleInput.value = preset.role;
  if (state.cities.includes(preset.city)) {
    els.citySelect.value = preset.city;
  }
}

async function runAnalysis(mode, overridePayload = null) {
  showError("");
  const loadingMsg =
    mode === "offline"
      ? "Loading offline demo snapshot..."
      : "Scanning live job market & extracting skills...";
  setLoading(true, loadingMsg);

  try {
    let payload;
    if (overridePayload) {
      payload = { ...overridePayload, limit: Number(els.scanDepthSelect.value || 10) };
    } else {
      const source = getSelectedSource();
      const role = els.targetRoleInput.value.trim();
      const location = els.citySelect.value;
      const limit = Number(els.scanDepthSelect.value || 10);
      payload = { mode, role, location, limit };

      if (source === "preset") {
        const idx = Number(els.personaSelect.value || 0);
        payload.resumeText = state.presets[idx]?.text || "";
      } else if (source === "paste") {
        payload.resumeText = els.pastedResumeInput.value;
      } else if (source === "pdf") {
        if (!state.selectedPdfBase64) {
          throw new Error("Please upload a PDF resume or switch to 1-Click Sample Preset.");
        }
        payload.pdfBase64 = state.selectedPdfBase64;
      }
    }

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.switchToPaste) {
        setSelectedSource("paste");
        els.pastedResumeInput.focus();
      }
      throw new Error(data.error || `Request failed with status ${response.status}`);
    }

    state.activeResult = data;
    state.toolkitData = null;
    state.simulatedSkills.clear();
    state.openRoadmapSkills.clear();
    const firstGap = data.baseline?.missing_gaps?.[0]?.skill;
    if (firstGap) state.openRoadmapSkills.add(firstGap);

    state.jobFilterQuery = "";
    state.onlyUnlocked = false;
    els.jobFilterInput.value = "";
    els.onlyUnlockedToggle.checked = false;
    els.evidenceDrawer.classList.add("hidden");
    updateCacheBadge(data.cacheStats);
    renderDashboard();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    setLoading(false);
  }
}

async function loadCoursesOnDemand(skill, buttonEl) {
  const data = state.activeResult;
  if (!data) return;
  buttonEl.disabled = true;
  buttonEl.textContent = "Loading...";
  state.openRoadmapSkills.add(skill);

  try {
    const res = await fetch("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill, role: data.role }),
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error || "Failed to fetch courses");
    }
    data.coursesBySkill[skill] = {
      ...(data.coursesBySkill[skill] || { skill }),
      courses: payload.courses || [],
      course_reason: payload.reason || "no_results",
      course_source: payload.data_source || "none",
      mini_project_idea: payload.mini_project_idea || "",
    };
    updateCacheBadge(payload.cacheStats);
    if (payload.budgetStats) data.budgetStats = payload.budgetStats;
    renderDashboard();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    buttonEl.disabled = false;
    buttonEl.textContent = "Load Courses & Docs";
  }
}

async function loadCompanyPulse() {
  const data = state.activeResult;
  if (!data) return;
  const companies = [
    ...new Set((data.jobs || []).map((j) => j.company).filter(Boolean)),
  ].slice(0, 4);
  if (companies.length === 0) return;

  els.loadCompanyNewsBtn.disabled = true;
  els.loadCompanyNewsBtn.textContent = "Loading News...";
  try {
    const res = await fetch("/api/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Could not load company news");
    data.companyPulse = { ...(data.companyPulse || {}), ...(payload.companyPulse || {}) };
    updateCacheBadge(payload.cacheStats);
    renderDashboard();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    els.loadCompanyNewsBtn.disabled = false;
    els.loadCompanyNewsBtn.textContent = "Load Company Pulse (News)";
  }
}

async function runCareerToolkit() {
  const data = state.activeResult;
  if (!data) return;
  els.runToolkitBtn.disabled = true;
  els.runToolkitBtn.textContent = "Benchmarking...";

  try {
    const mode = data.analysisMode === "offline_demo" ? "offline" : "quick";
    const res = await fetch("/api/toolkit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resumeText: data.resumeText || "",
        role: data.role,
        location: data.location,
        mode,
      }),
    });
    const toolkit = await res.json();
    if (!res.ok) throw new Error(toolkit.error || "Toolkit benchmark failed");
    state.toolkitData = toolkit;
    updateCacheBadge(toolkit.cacheStats);
    if (toolkit.budgetStats) data.budgetStats = toolkit.budgetStats;
    renderToolkitTab();
    renderHeaderTelemetry(data);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    els.runToolkitBtn.disabled = false;
    els.runToolkitBtn.textContent = "Refresh Benchmark";
  }
}

function showSkillEvidence(skill, sourceType = "jobs") {
  const data = state.activeResult;
  if (!data) return;

  if (sourceType === "resume") {
    const sentence = data.resumeEvidence?.[skill];
    els.evidenceTitle.textContent = `Resume Evidence for "${skill}"`;
    els.evidenceSubtitle.textContent = "Exact snippet in your resume where this skill was detected:";
    els.evidenceList.innerHTML = sentence
      ? `<div class="sb-evidence-item"><strong>Your Resume:</strong> "${escapeHtml(sentence)}"</div>`
      : `<div class="sb-evidence-item">Detected in your resume text as <strong>${escapeHtml(skill)}</strong>.</div>`;
    els.evidenceDrawer.classList.remove("hidden");
    return;
  }

  const matchingJobs = (data.jobs || []).filter((j) =>
    (j.extracted_skills || []).includes(skill)
  );
  els.evidenceTitle.textContent = `Market Evidence for "${skill}" (${matchingJobs.length} job${
    matchingJobs.length === 1 ? "" : "s"
  })`;
  els.evidenceSubtitle.textContent = "Exact qualification/description lines mentioning this skill:";
  els.evidenceList.innerHTML = matchingJobs.length
    ? matchingJobs
        .map((j) => {
          const snippet =
            j.skill_evidence?.[skill] ||
            (j.qualifications || [])[0] ||
            (j.description || "").slice(0, 180);
          return `
            <div class="sb-evidence-item">
              <strong>${escapeHtml(j.title)}</strong> (${escapeHtml(j.company)})
              <div class="sb-caption">"${escapeHtml(snippet)}"</div>
            </div>
          `;
        })
        .join("")
    : `<div class="sb-evidence-item">No job postings in this scan mentioned ${escapeHtml(skill)}.</div>`;
  els.evidenceDrawer.classList.remove("hidden");
}

function renderHeaderTelemetry(data) {
  const srcLabel =
    data.data_source === "live"
      ? "Live"
      : data.data_source === "demo"
      ? "Demo"
      : "Cache";
  els.modeChip.textContent = `${data.role} · ${data.location} · Source: ${srcLabel}`;
  els.modeChip.classList.remove("hidden");

  const budget = data.budgetStats || {};
  const calls = budget.dailySerpApiCalls ?? 0;
  const hits = budget.dailyCacheHits ?? 0;
  const deepReads = data.deepReadCount ?? 0;
  els.telemetryChip.textContent = `SerpApi calls: ${calls} · Cache hits: ${hits} · Deep-read pages: ${deepReads}`;
  els.telemetryChip.classList.remove("hidden");
}

function renderDashboard() {
  const data = state.activeResult;
  if (!data) return;

  // U3: Capture currently focused simulator checkbox to restore focus after DOM update
  const activeSimSkill =
    document.activeElement?.getAttribute?.("data-sim-skill") || null;

  els.navLinks.forEach((btn) => {
    btn.disabled = false;
  });
  if (state.activePage === "setup") {
    navigateTo("overview");
  }

  renderHeaderTelemetry(data);
  applySourceBadge(els.gapsSourceBadge, data.data_source);
  applySourceBadge(els.jobsSourceBadge, data.data_source);

  els.sidebarSkillsSection.classList.remove("hidden");
  els.sidebarSkillsPills.innerHTML =
    renderPillsHtml(data.userSkills, "matched", { clickableResume: true }) ||
    '<span class="sb-caption">No recognized technical skills detected yet.</span>';

  els.sidebarSkillsPills.querySelectorAll("[data-resume-skill]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showSkillEvidence(btn.getAttribute("data-resume-skill"), "resume");
    });
  });

  if (data.offlineDemoNotice) {
    els.offlineNotice.textContent = data.offlineDemoNotice;
    els.offlineNotice.classList.remove("hidden");
  } else {
    els.offlineNotice.classList.add("hidden");
  }

  // U2: Show sample size warning when < 15 jobs scanned
  const scannedCount = (data.jobs || []).length;
  if (scannedCount > 0 && scannedCount < 15) {
    els.sampleWarning.textContent = `Based on ${scannedCount} jobs (< 15 is a small sample — increase Scan Depth to 20 or 30 for stronger confidence).`;
    els.sampleWarning.classList.remove("hidden");
  } else {
    els.sampleWarning.classList.add("hidden");
  }

  const baseline = data.baseline;
  const selectedSim = [...state.simulatedSkills];
  const current = analyzeSkillGaps({
    role: data.role,
    location: data.location,
    userSkills: data.userSkills,
    jobs: data.jobs,
    demandList: data.demandList,
    simulatedSkills: selectedSim,
  });

  const readinessDelta = Math.round((current.readiness_score - baseline.readiness_score) * 10) / 10;
  const unlockedDelta = current.ready_jobs.length - baseline.ready_jobs.length;

  // Top KPI Metrics
  els.metricReadiness.textContent = `${current.readiness_score.toFixed(1)}%`;
  if (readinessDelta > 0) {
    els.metricReadinessDelta.textContent = `+${readinessDelta.toFixed(1)}% Readiness`;
    els.metricReadinessDelta.classList.remove("hidden");
  } else {
    els.metricReadinessDelta.classList.add("hidden");
  }

  els.metricJobsScanned.textContent = String(scannedCount);
  els.metricJobsMeta.textContent = `${current.eligible_jobs_count} eligible`;

  els.metricReadyCount.textContent = String(current.ready_jobs.length);
  if (unlockedDelta > 0) {
    els.metricReadyDelta.textContent = `+${unlockedDelta} ready`;
    els.metricReadyDelta.classList.remove("hidden");
  } else {
    els.metricReadyDelta.classList.add("hidden");
  }

  // B5: Honest Top ROI wording (never 'Unlocks X' unless using net_ready_unlocked)
  const topGap = current.missing_gaps[0] || null;
  els.metricTopRoi.textContent = topGap ? topGap.skill : "All Covered";
  if (topGap) {
    els.metricTopRoiSub.textContent = `${topGap.net_ready_unlocked} ready · ${topGap.jobs_unlocked}/${current.eligible_jobs_count} req`;
    els.metricTopRoiSub.classList.remove("hidden");
  } else {
    els.metricTopRoiSub.classList.add("hidden");
  }

  // Dual Progress Bar
  const basePct = Math.max(0, Math.min(100, baseline.readiness_score));
  const currPct = Math.max(basePct, Math.min(100, current.readiness_score));
  const boost = Math.round((currPct - basePct) * 10) / 10;
  els.progressLabel.textContent =
    boost > 0 ? `Market Readiness (+${boost.toFixed(1)}% simulated)` : "Market Readiness";
  els.progressValue.textContent = `${currPct.toFixed(1)}%`;
  els.progressBase.style.width = `${basePct.toFixed(1)}%`;
  els.progressSim.style.left = `${basePct.toFixed(1)}%`;
  els.progressSim.style.width = `${boost.toFixed(1)}%`;

  // Simulator Checkboxes
  const top5 = baseline.missing_gaps.slice(0, 5);
  els.simulatorPanel.classList.toggle("hidden", top5.length === 0);
  els.simResetBtn.disabled = selectedSim.length === 0;
  els.simulatorCheckboxes.innerHTML = top5
    .map((gap) => {
      const checked = state.simulatedSkills.has(gap.skill);
      return `
        <label class="sb-sim-option ${checked ? "active" : ""}" title="Present in ${gap.demand_pct.toFixed(0)}% of eligible openings">
          <input type="checkbox" data-sim-skill="${escapeHtml(gap.skill)}" ${checked ? "checked" : ""} />
          <span>${escapeHtml(gap.skill)} (${gap.net_ready_unlocked} ready · ${gap.jobs_unlocked} req)</span>
        </label>
      `;
    })
    .join("");

  els.simulatorCheckboxes.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    box.addEventListener("change", (ev) => {
      const skill = ev.target.getAttribute("data-sim-skill");
      if (ev.target.checked) state.simulatedSkills.add(skill);
      else state.simulatedSkills.delete(skill);
      renderDashboard();
    });
  });

  // Restore focus to checkbox if keyboard user toggled it
  if (activeSimSkill) {
    const targetBox = [...els.simulatorCheckboxes.querySelectorAll("input[type='checkbox']")].find(
      (b) => b.getAttribute("data-sim-skill") === activeSimSkill
    );
    if (targetBox) targetBox.focus();
  }

  if (selectedSim.length > 0) {
    els.simActiveBanner.innerHTML = `<strong>Simulation Active (${escapeHtml(selectedSim.join(", "))}):</strong> +${readinessDelta.toFixed(1)}% Readiness · Makes +${unlockedDelta} more job${unlockedDelta === 1 ? "" : "s"} ready · ${current.missing_gaps.length} Remaining Gaps`;
    els.simActiveBanner.classList.remove("hidden");
  } else {
    els.simActiveBanner.classList.add("hidden");
  }

  renderGapsTab(data, current, selectedSim);
  renderJobsTab(data, current, selectedSim);
  renderRawDemandTab(data, current, selectedSim);
  renderToolkitTab();
}

function renderGapsTab(data, current, selectedSim) {
  const topGaps = current.missing_gaps.slice(0, 12);
  if (topGaps.length === 0) {
    els.gapChartContainer.innerHTML =
      '<div class="sb-alert sb-alert-success">All tracked market skill gaps are covered!</div>';
  } else {
    const maxRequired = Math.max(...topGaps.map((g) => g.jobs_unlocked), 1);
    els.gapChartContainer.innerHTML = topGaps
      .map((gap) => {
        const widthPct = Math.round((gap.jobs_unlocked / maxRequired) * 100);
        const salaryTag = gap.salary_lift
          ? ` (${gap.salary_lift.lift_pct >= 0 ? "+" : ""}${gap.salary_lift.lift_pct}% pay)`
          : "";
        return `
          <button type="button" class="sb-chart-row" data-evidence-skill="${escapeHtml(gap.skill)}" title="Click for exact evidence snippets">
            <span class="sb-chart-skill">${escapeHtml(gap.skill)}</span>
            <span class="sb-chart-track">
              <span class="sb-chart-bar" style="display:block;width: ${widthPct}%"></span>
            </span>
            <span class="sb-chart-val">${gap.jobs_unlocked} req · ${gap.net_ready_unlocked} ready${escapeHtml(salaryTag)}</span>
          </button>
        `;
      })
      .join("");

    els.gapChartContainer.querySelectorAll("[data-evidence-skill]").forEach((row) => {
      row.addEventListener("click", () => {
        showSkillEvidence(row.getAttribute("data-evidence-skill"), "jobs");
      });
    });
  }

  const eligibleDemand = current.demand_list || [];
  const demandSkillSet = new Set(eligibleDemand.map((d) => d.skill));
  const coveredCount = current.matched_skills.filter((s) => demandSkillSet.has(s)).length;
  els.snapshotMeta.innerHTML = `Target: <strong>${escapeHtml(current.role)}</strong> · <strong>${escapeHtml(current.location)}</strong> · Covering <strong>${coveredCount}/${demandSkillSet.size}</strong> tracked skills across <strong>${current.eligible_jobs_count}</strong> eligible jobs`;

  const simSet = new Set(selectedSim);
  let matchedResume = current.matched_skills.filter((s) => !simSet.has(s));
  if (matchedResume.length === 0 && data.userSkills.length > 0) {
    matchedResume = data.userSkills.filter((s) => !simSet.has(s));
  }
  els.snapshotMatched.innerHTML =
    renderPillsHtml(matchedResume, "matched") ||
    '<span class="sb-caption">No resume skills matched the scanned postings yet.</span>';

  els.snapshotSimGroup.classList.toggle("hidden", selectedSim.length === 0);
  els.snapshotSimulated.innerHTML = renderPillsHtml(selectedSim, "sim");

  const remainingTop = current.missing_gaps.slice(0, 10).map((g) => g.skill);
  els.snapshotMissing.innerHTML =
    renderPillsHtml(remainingTop, "missing") ||
    '<span class="sb-caption">No remaining skill gaps.</span>';

  // Feature #6: 4-Week Plan
  const plan = Array.isArray(data.fourWeekPlan) ? data.fourWeekPlan : [];
  if (plan.length === 0) {
    els.fourWeekPlanGrid.innerHTML =
      '<div class="sb-caption">No study weeks needed — your skills already cover the market!</div>';
  } else {
    els.fourWeekPlanGrid.innerHTML = plan
      .map((wk) => {
        const resLinks = (wk.resources || [])
          .map((c) => {
            const safe = sanitizeHttpUrl(c.url);
            return safe
              ? `<div><a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.title)}</a></div>`
              : "";
          })
          .join("");
        return `
          <div class="sb-week-card">
            <div class="sb-step-num">WEEK ${wk.week}</div>
            <strong>${escapeHtml(wk.title)}</strong>
            <div class="sb-caption">${escapeHtml(wk.goal)}</div>
            ${resLinks ? `<div style="font-size:0.78rem;">${resLinks}</div>` : ""}
            <div class="sb-caption"><strong>Deliverable:</strong> ${escapeHtml(wk.deliverable)}</div>
          </div>
        `;
      })
      .join("");
  }

  // Learning Roadmap with preserved open accordions (U1)
  if (current.missing_gaps.length === 0) {
    els.learningRoadmap.innerHTML =
      '<div class="sb-alert sb-alert-success">No learning gaps left — you are ready to apply to the matched roles!</div>';
    return;
  }

  els.learningRoadmap.innerHTML = current.missing_gaps
    .map((gap) => {
      const cached = data.coursesBySkill[gap.skill] || gap;
      const isOpen = state.openRoadmapSkills.has(gap.skill);
      const salaryText = gap.salary_lift
        ? ` · Salary lift: ${gap.salary_lift.lift_pct >= 0 ? "+" : ""}${gap.salary_lift.lift_pct}% (${gap.salary_lift.sample_size} salary jobs)`
        : "";

      const projectHtml = cached.mini_project_idea
        ? `<div class="sb-alert sb-alert-info"><div><strong>Weekend Proof-of-Work Mini-Project:</strong> ${escapeHtml(cached.mini_project_idea)}</div></div>`
        : "";

      let coursesHtml = "";
      if (cached.courses && cached.courses.length > 0) {
        coursesHtml = `<div class="sb-courses-grid">${cached.courses
          .map((course) => {
            const safeUrl = sanitizeHttpUrl(course.url);
            const safeThumb = sanitizeHttpUrl(course.thumbnail);
            const thumb = safeThumb
              ? `<img class="sb-course-thumb" src="${escapeHtml(safeThumb)}" alt="${escapeHtml(course.title)}" loading="lazy" />`
              : "";
            const meta = [course.channel_or_site, course.source, course.duration]
              .filter(Boolean)
              .map(escapeHtml)
              .join(" · ");
            const ctaText =
              course.source === "Google Search" ? "Open Official Guide" : "Watch Tutorial";
            return `
              <div class="sb-course-card">
                ${thumb}
                ${
                  safeUrl
                    ? `<a class="sb-course-title" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(course.title)}</a>`
                    : `<span class="sb-course-title">${escapeHtml(course.title)}</span>`
                }
                <div class="sb-caption">${meta}</div>
                ${
                  safeUrl
                    ? `<a class="sb-btn sb-btn-secondary sb-btn-sm" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${ctaText}</a>`
                    : ""
                }
              </div>
            `;
          })
          .join("")}</div>`;
      } else {
        const reasonMsg = formatCourseReason(cached.course_reason);
        coursesHtml = `
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.6rem;">
            <span class="sb-caption">${escapeHtml(reasonMsg)}</span>
            <button class="sb-btn sb-btn-secondary sb-btn-sm" data-load-course="${escapeHtml(gap.skill)}" type="button">
              Load Courses &amp; Docs
            </button>
          </div>
        `;
      }

      return `
        <details class="sb-expander" data-gap-skill="${escapeHtml(gap.skill)}" ${isOpen ? "open" : ""}>
          <summary>#${gap.priority_rank} ${escapeHtml(gap.skill)} — Required in ${gap.jobs_unlocked} job${gap.jobs_unlocked === 1 ? "" : "s"} (${gap.demand_pct.toFixed(1)}% demand) · Makes ${gap.net_ready_unlocked} more job${gap.net_ready_unlocked === 1 ? "" : "s"} ready${escapeHtml(salaryText)}</summary>
          <div class="sb-expander-body">
            ${projectHtml}
            ${coursesHtml}
          </div>
        </details>
      `;
    })
    .join("");

  els.learningRoadmap.querySelectorAll("details[data-gap-skill]").forEach((det) => {
    det.addEventListener("toggle", () => {
      const skill = det.getAttribute("data-gap-skill");
      if (det.open) state.openRoadmapSkills.add(skill);
      else state.openRoadmapSkills.delete(skill);
    });
  });

  els.learningRoadmap.querySelectorAll("[data-load-course]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const skill = btn.getAttribute("data-load-course");
      loadCoursesOnDemand(skill, btn);
    });
  });
}

function renderJobCardHtml(job, effectiveSet, simSet, bucketType, newlyUnlocked, companyPulse) {
  const matchedResume = (job.extracted_skills || []).filter(
    (s) => effectiveSet.has(s) && !simSet.has(s)
  );
  const matchedSim = (job.extracted_skills || []).filter((s) => simSet.has(s));
  const missing = (job.extracted_skills || []).filter((s) => !effectiveSet.has(s));

  let badgeHtml;
  if (bucketType === "ready") {
    badgeHtml = '<span class="sb-badge-ready">Ready to Apply</span>';
  } else if (bucketType === "low_data") {
    badgeHtml = '<span class="sb-badge-almost">Low Data (&lt; 3 skills)</span>';
  } else {
    badgeHtml = `<span class="sb-badge-almost">${missing.length} Skill${missing.length === 1 ? "" : "s"} Away</span>`;
  }

  const unlockedHtml = newlyUnlocked
    ? '<span class="sb-badge-unlocked">Unlocked by What-If</span>'
    : "";
  const deepReadHtml = job.deep_read
    ? '<span class="sb-badge-deep">Deep-read</span>'
    : "";

  const salaryHtml = job.salary_text ? ` · ${escapeHtml(job.salary_text)}` : "";
  const remoteHtml = job.work_from_home ? " · Remote" : "";
  const safeApplyUrl = sanitizeHttpUrl(job.apply_url);

  const qualsList = (job.qualifications || []).slice(0, 5);
  const snippet = (job.description || "").trim();
  const shortDesc = snippet.length > 360 ? `${snippet.slice(0, 357).trim()}...` : snippet;

  const pulse = companyPulse?.[job.company];
  let newsHtml = "";
  if (pulse && Array.isArray(pulse.headlines) && pulse.headlines.length > 0) {
    newsHtml = `
      <div class="sb-news-box">
        <strong>Company Pulse:</strong>
        ${pulse.headlines
          .map((h) => {
            const safeLink = sanitizeHttpUrl(h.link);
            const sentBadge =
              h.sentiment === "Risk"
                ? '<span class="sb-pill sb-pill-missing">Risk</span>'
                : h.sentiment === "Opportunity"
                ? '<span class="sb-pill sb-pill-matched">Opportunity</span>'
                : '<span class="sb-pill">News</span>';
            return `<div style="margin-top:0.28rem;">${sentBadge} ${
              safeLink
                ? `<a href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(h.title)}</a>`
                : escapeHtml(h.title)
            } <span class="sb-caption">(${escapeHtml(h.source)})</span></div>`;
          })
          .join("")}
      </div>
    `;
  }

  return `
    <article class="sb-job-card">
      <div class="sb-job-head">
        <div>
          <div class="sb-job-title">${escapeHtml(job.title)}</div>
          <div class="sb-job-meta">${escapeHtml(job.company)} · ${escapeHtml(job.location)}${remoteHtml}${salaryHtml}</div>
        </div>
        <div class="sb-badge-group">${deepReadHtml}${unlockedHtml}${badgeHtml}</div>
      </div>
      ${matchedResume.length ? `<div class="sb-job-label">Matched Skills</div><div class="sb-pills-wrap">${renderPillsHtml(matchedResume, "matched")}</div>` : ""}
      ${matchedSim.length ? `<div class="sb-job-label">Simulated Skills</div><div class="sb-pills-wrap">${renderPillsHtml(matchedSim, "sim")}</div>` : ""}
      ${missing.length ? `<div class="sb-job-label">Missing Skills</div><div class="sb-pills-wrap">${renderPillsHtml(missing, "missing")}</div>` : ""}
      ${newsHtml}
      ${
        qualsList.length || shortDesc
          ? `<details class="sb-details"><summary>View Qualifications &amp; Summary</summary>${
              qualsList.length
                ? `<ul class="sb-job-quals">${qualsList.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>`
                : ""
            }${shortDesc ? `<p class="sb-caption">${escapeHtml(shortDesc)}</p>` : ""}</details>`
          : ""
      }
      ${
        safeApplyUrl
          ? `<a class="sb-btn sb-btn-primary sb-btn-sm" href="${escapeHtml(safeApplyUrl)}" target="_blank" rel="noopener noreferrer">Apply Now</a>`
          : ""
      }
    </article>
  `;
}

function renderJobsTab(data, current, selectedSim) {
  const effectiveSet = new Set([...data.userSkills, ...selectedSim]);
  const simSet = new Set(selectedSim);
  const baselineReadyIds = new Set(data.baseline.ready_jobs.map((j) => j.job_id));
  const query = state.jobFilterQuery.trim().toLowerCase();

  els.onlyUnlockedWrap.classList.toggle("hidden", selectedSim.length === 0);

  const matchesFilter = (job) => {
    if (!query) return true;
    const hay = [job.title, job.company, job.location, ...(job.extracted_skills || [])]
      .join(" ")
      .toLowerCase();
    return hay.includes(query);
  };

  const readyFiltered = current.ready_jobs.filter(
    (job) =>
      matchesFilter(job) &&
      (!state.onlyUnlocked || !baselineReadyIds.has(job.job_id))
  );
  const almostFiltered = current.almost_ready_jobs.filter(
    (job) => !state.onlyUnlocked && matchesFilter(job)
  );
  const lowDataFiltered = (current.low_data_jobs || []).filter(
    (job) => !state.onlyUnlocked && matchesFilter(job)
  );

  els.readyBucketTitle.textContent = `Ready to Apply Today (${readyFiltered.length})`;
  els.almostBucketTitle.textContent = `Almost Ready — 2–3 Skills Away (${almostFiltered.length})`;

  els.readyJobsList.innerHTML = readyFiltered.length
    ? readyFiltered
        .map((job) =>
          renderJobCardHtml(
            job,
            effectiveSet,
            simSet,
            "ready",
            selectedSim.length > 0 && !baselineReadyIds.has(job.job_id),
            data.companyPulse
          )
        )
        .join("")
    : '<div class="sb-alert sb-alert-info">No postings match the current filter or &gt;=75% threshold with at least 1 matched skill.</div>';

  els.almostJobsList.innerHTML = almostFiltered.length
    ? almostFiltered
        .map((job) =>
          renderJobCardHtml(
            job,
            effectiveSet,
            simSet,
            "almost",
            false,
            data.companyPulse
          )
        )
        .join("")
    : '<div class="sb-alert sb-alert-info">No postings currently match this bucket.</div>';

  if (lowDataFiltered.length > 0) {
    els.lowDataSection.classList.remove("hidden");
    els.lowDataTitle.textContent = `Low-Data Listings (< 3 Skills Detected: ${lowDataFiltered.length})`;
    els.lowDataJobsList.innerHTML = lowDataFiltered
      .map((job) =>
        renderJobCardHtml(
          job,
          effectiveSet,
          simSet,
          "low_data",
          false,
          data.companyPulse
        )
      )
      .join("");
  } else {
    els.lowDataSection.classList.add("hidden");
  }
}

function renderRawDemandTab(data, current, selectedSim) {
  const userSet = new Set(data.userSkills);
  const simSet = new Set(selectedSim);
  const gapMap = new Map(current.missing_gaps.map((g) => [g.skill, g]));
  const eligibleDemand = current.demand_list || [];

  const rows = eligibleDemand
    .map((item) => {
      const status = userSet.has(item.skill)
        ? "Matched"
        : simSet.has(item.skill)
        ? "Simulated"
        : "Missing";
      const gap = gapMap.get(item.skill);
      return {
        ...item,
        status,
        makesReady: gap ? gap.net_ready_unlocked : 0,
      };
    })
    .filter(
      (row) => state.demandStatusFilter === "All" || row.status === state.demandStatusFilter
    );

  if (rows.length === 0) {
    els.rawDemandTbody.innerHTML =
      '<tr><td colspan="6" class="sb-caption">No skills match the selected status filter.</td></tr>';
    return;
  }

  els.rawDemandTbody.innerHTML = rows
    .map((row) => {
      const pillVariant =
        row.status === "Matched"
          ? "matched"
          : row.status === "Simulated"
          ? "sim"
          : "missing";
      const pct = Math.min(100, Math.round(row.demand_pct * 10) / 10);
      const trendSymbol =
        row.trend === "up"
          ? `↑ +${row.trend_delta}%`
          : row.trend === "down"
          ? `↓ ${row.trend_delta}%`
          : row.trend === "new"
          ? "NEW"
          : "—";
      return `
        <tr>
          <td><strong>${escapeHtml(row.skill)}</strong></td>
          <td>${renderPillsHtml([row.status], pillVariant)}</td>
          <td>${row.job_count} / ${row.total_jobs}</td>
          <td>${row.makesReady}</td>
          <td>${escapeHtml(trendSymbol)}</td>
          <td>
            <div class="sb-demand-cell">
              <div class="sb-demand-bar-bg">
                <div class="sb-demand-bar-fill" style="width: ${pct}%"></div>
              </div>
              <span>${pct.toFixed(1)}%</span>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderToolkitTab() {
  const data = state.activeResult;
  if (!data) return;

  const ats = data.atsBullets || {};
  const verified = Array.isArray(ats.verifiedBullets) ? ats.verifiedBullets : [];
  const future = Array.isArray(ats.afterYouLearnBullets) ? ats.afterYouLearnBullets : [];

  if (ats.label) {
    els.atsTitle.textContent = `ATS Resume ${ats.label}`;
  }

  if (ats.guidance) {
    els.atsGuidanceBox.textContent = ats.guidance;
    els.atsGuidanceBox.classList.remove("hidden");
  } else {
    els.atsGuidanceBox.classList.add("hidden");
  }

  els.atsVerifiedSection.classList.toggle("hidden", verified.length === 0);
  els.atsBulletsList.innerHTML = verified.map((b) => `<li>${escapeHtml(b)}</li>`).join("");

  els.atsFutureSection.classList.toggle("hidden", future.length === 0);
  els.atsFutureList.innerHTML = future.map((b) => `<li>${escapeHtml(b)}</li>`).join("");

  if (!state.toolkitData) {
    els.toolkitResultsWrap.innerHTML =
      '<div class="sb-caption">Click <strong>Run Multi-Role &amp; Remote Benchmark</strong> above to compare your Target Role + 2 adjacent tracks and Local vs. Remote demand.</div>';
    return;
  }

  const { multiRole, localVsRemote } = state.toolkitData;
  const evals = multiRole?.evaluations || [];
  const bestRole = multiRole?.best_fit_role;

  const rolesHtml = `
    <h4 class="sb-snapshot-label">Multi-Role Fit Comparison (Target + Adjacent Tracks)</h4>
    <div class="sb-role-grid">
      ${evals
        .map((ev) => {
          const isBest = ev.role === bestRole;
          const badge = isBest
            ? '<span class="sb-badge-ready">Best Fit / Shortest Path</span>'
            : ev.is_target_role
            ? '<span class="sb-badge-unlocked">Target Role</span>'
            : '<span class="sb-badge-almost">Adjacent Track</span>';
          const gaps = (ev.top_gaps || []).map((g) => g.skill);
          return `
            <div class="sb-role-card ${isBest ? "best-fit" : ""}">
              <div class="sb-job-head">
                <strong>${escapeHtml(ev.role)}</strong>
                <div class="sb-badge-group">${renderSourceBadgeHtml(ev.data_source)}${badge}</div>
              </div>
              <div class="sb-metric-value">${ev.readiness_score.toFixed(1)}%</div>
              <div class="sb-caption">Ready Today: <strong>${ev.ready_jobs_count}/${ev.jobs_scanned}</strong> · Almost Ready: <strong>${ev.almost_ready_count}</strong></div>
              <div class="sb-job-label">Top Missing Skills</div>
              <div class="sb-pills-wrap">${renderPillsHtml(gaps, "missing") || '<span class="sb-caption">None</span>'}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;

  const loc = localVsRemote?.local;
  const rem = localVsRemote?.remote;
  const locVsRemHtml =
    loc && rem
      ? `
    <h4 class="sb-snapshot-label">Local City vs. Remote Market Demand (${escapeHtml(data.role)})</h4>
    <div class="sb-loc-grid">
      <div class="sb-role-card">
        <div class="sb-job-head">
          <strong>Local: ${escapeHtml(loc.location)}</strong>
          <div class="sb-badge-group">${renderSourceBadgeHtml(loc.data_source)}<span class="sb-badge-unlocked">Readiness: ${loc.readiness_score.toFixed(1)}%</span></div>
        </div>
        <div class="sb-caption">Ready Jobs: <strong>${loc.ready_jobs_count}</strong> · #1 Gap: <strong>${escapeHtml(loc.top_gap)}</strong></div>
        <div class="sb-job-label">Top Demanded Local Skills</div>
        <div class="sb-pills-wrap">${renderPillsHtml(
          (loc.top_skills || []).map((s) => `${s.skill} (${s.demand_pct.toFixed(0)}%)`),
          "sim"
        )}</div>
      </div>
      <div class="sb-role-card">
        <div class="sb-job-head">
          <strong>${escapeHtml(rem.location)}</strong>
          <div class="sb-badge-group">${renderSourceBadgeHtml(rem.data_source)}<span class="sb-badge-unlocked">Readiness: ${rem.readiness_score.toFixed(1)}%</span></div>
        </div>
        <div class="sb-caption">Ready Jobs: <strong>${rem.ready_jobs_count}</strong> · #1 Gap: <strong>${escapeHtml(rem.top_gap)}</strong></div>
        <div class="sb-job-label">Top Demanded Remote Skills</div>
        <div class="sb-pills-wrap">${renderPillsHtml(
          (rem.top_skills || []).map((s) => `${s.skill} (${s.demand_pct.toFixed(0)}%)`),
          "sim"
        )}</div>
      </div>
    </div>
  `
      : "";

  els.toolkitResultsWrap.innerHTML = rolesHtml + locVsRemHtml;
}

function downloadDemandCsv() {
  const data = state.activeResult;
  if (!data) return;
  const current = analyzeSkillGaps({
    role: data.role,
    location: data.location,
    userSkills: data.userSkills,
    jobs: data.jobs,
    demandList: data.demandList,
    simulatedSkills: [...state.simulatedSkills],
  });

  const userSet = new Set(data.userSkills);
  const simSet = state.simulatedSkills;
  const gapMap = new Map(current.missing_gaps.map((g) => [g.skill, g]));

  const lines = [
    "Skill,Your Status,Required in Jobs,Makes Ready Today,Total Eligible Jobs,Market Demand (%)",
  ];
  for (const item of current.demand_list || []) {
    const status = userSet.has(item.skill)
      ? "Matched"
      : simSet.has(item.skill)
      ? "Simulated"
      : "Missing";
    const gap = gapMap.get(item.skill);
    const makesReady = gap ? gap.net_ready_unlocked : 0;
    const escapedSkill = `"${String(item.skill).replace(/"/g, '""')}"`;
    lines.push(
      `${escapedSkill},${status},${item.job_count},${makesReady},${item.total_jobs},${item.demand_pct.toFixed(1)}`
    );
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = data.role.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "skillbridge";
  a.download = `skillbridge_demand_${slug}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function init() {
  const res = await fetch("/api/presets");
  const { presets, cities, cache } = await res.json();
  state.presets = presets;
  state.cities = cities;
  updateCacheBadge(cache);

  els.personaSelect.innerHTML = presets
    .map((p, idx) => `<option value="${idx}">${escapeHtml(p.label)}</option>`)
    .join("");
  els.citySelect.innerHTML = cities
    .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
    .join("");
  applySelectedPreset(0);

  els.sourceRadios.forEach((radio) => {
    radio.addEventListener("change", () => setSelectedSource(getSelectedSource()));
  });

  els.personaSelect.addEventListener("change", (ev) => {
    applySelectedPreset(Number(ev.target.value));
  });

  // B4: Client PDF validation (file type & max 5 MB)
  els.pdfFileInput.addEventListener("change", (ev) => {
    showError("");
    const file = ev.target.files?.[0];
    if (!file) {
      state.selectedPdfBase64 = null;
      els.pdfFileName.textContent = "No file chosen";
      return;
    }

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      ev.target.value = "";
      state.selectedPdfBase64 = null;
      els.pdfFileName.textContent = "Invalid file type";
      showError("Please select a valid .pdf file, or paste your resume text instead.");
      setSelectedSource("paste");
      return;
    }

    if (file.size > MAX_PDF_BYTES) {
      ev.target.value = "";
      state.selectedPdfBase64 = null;
      els.pdfFileName.textContent = "File exceeds 5 MB";
      showError("PDF exceeds the 5 MB limit. Paste your resume text instead.");
      setSelectedSource("paste");
      return;
    }

    els.pdfFileName.textContent = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      state.selectedPdfBase64 = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });

  const triggerQuickPreset = (idx) => {
    setSelectedSource("preset");
    const safeIdx = idx < state.presets.length ? idx : 0;
    applySelectedPreset(safeIdx);
    const p = state.presets[safeIdx];
    runAnalysis("quick", {
      mode: "quick",
      role: p.role,
      location: p.city,
      resumeText: p.text,
    });
  };

  els.quickStudentBtn.addEventListener("click", () => triggerQuickPreset(0));
  els.quickBackendBtn.addEventListener("click", () => triggerQuickPreset(1));
  if (els.quickAnalystBtn) {
    els.quickAnalystBtn.addEventListener("click", () => triggerQuickPreset(2));
  }

  els.analyzeLiveBtn.addEventListener("click", () => runAnalysis("live"));
  els.loadOfflineBtn.addEventListener("click", () => runAnalysis("offline"));

  els.simTop3Btn.addEventListener("click", () => {
    const top3 = state.activeResult?.baseline?.missing_gaps?.slice(0, 3) || [];
    state.simulatedSkills = new Set(top3.map((g) => g.skill));
    renderDashboard();
  });

  els.simResetBtn.addEventListener("click", () => {
    state.simulatedSkills.clear();
    renderDashboard();
  });

  els.closeEvidenceBtn.addEventListener("click", () => {
    els.evidenceDrawer.classList.add("hidden");
  });

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-tab");
      els.tabs.forEach((t) => {
        const isTarget = t === tab;
        t.classList.toggle("active", isTarget);
        t.setAttribute("aria-selected", String(isTarget));
      });
      els.tabPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.id === `tab-${target}`);
      });
    });
  });

  els.jobFilterInput.addEventListener("input", (ev) => {
    state.jobFilterQuery = ev.target.value;
    if (state.activeResult) renderDashboard();
  });

  els.onlyUnlockedToggle.addEventListener("change", (ev) => {
    state.onlyUnlocked = ev.target.checked;
    if (state.activeResult) renderDashboard();
  });

  els.filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.demandStatusFilter = btn.getAttribute("data-status") || "All";
      els.filterBtns.forEach((b) => b.classList.toggle("active", b === btn));
      if (state.activeResult) renderDashboard();
    });
  });

  els.downloadCsvBtn.addEventListener("click", downloadDemandCsv);
  els.loadCompanyNewsBtn.addEventListener("click", loadCompanyPulse);
  els.runToolkitBtn.addEventListener("click", runCareerToolkit);
  els.printPlanBtn.addEventListener("click", () => window.print());

  els.shareLinkBtn.addEventListener("click", async () => {
    const data = state.activeResult;
    if (!data) return;
    const params = new URLSearchParams({
      role: data.role,
      city: data.location,
      sim: [...state.simulatedSkills].join(","),
    });
    const shareUrl = `${window.location.origin}${window.location.pathname}#${params.toString()}`;
    window.location.hash = params.toString();
    try {
      await navigator.clipboard.writeText(shareUrl);
      els.shareLinkBtn.textContent = "Link Copied!";
      setTimeout(() => {
        els.shareLinkBtn.textContent = "Copy Share Link";
      }, 1500);
    } catch {
      // Clipboard may be blocked on HTTP non-localhost
    }
  });

  els.copyBulletsBtn.addEventListener("click", async () => {
    const ats = state.activeResult?.atsBullets;
    const all = [
      ...(ats?.verifiedBullets || []),
      ...(ats?.afterYouLearnBullets || []),
    ];
    if (!all.length) return;
    try {
      await navigator.clipboard.writeText(all.map((b) => `• ${b}`).join("\n"));
      els.copyBulletsBtn.textContent = "Copied!";
      setTimeout(() => {
        els.copyBulletsBtn.textContent = "Copy Templates";
      }, 1500);
    } catch {
      // Clipboard blocked
    }
  });

  // Sub-page navigation & deep links
  els.navLinks.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetPage = btn.getAttribute("data-page");
      if (targetPage) navigateTo(targetPage);
    });
  });

  els.gotoButtons.forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const targetPage = btn.getAttribute("data-goto");
      if (targetPage) navigateTo(targetPage);
    });
  });

  window.addEventListener("hashchange", () => {
    const hashPage = window.location.hash.replace(/^#/, "");
    if (VALID_PAGES.has(hashPage)) {
      navigateTo(hashPage, false);
    }
  });

  // Load shared hash link if present
  if (window.location.hash.length > 1) {
    const rawHash = window.location.hash.slice(1);
    if (VALID_PAGES.has(rawHash)) {
      navigateTo(rawHash, false);
    } else {
      const hashParams = new URLSearchParams(rawHash);
      const sharedRole = hashParams.get("role");
      const sharedCity = hashParams.get("city");
      if (sharedRole) els.targetRoleInput.value = sharedRole;
      if (sharedCity && state.cities.includes(sharedCity)) els.citySelect.value = sharedCity;
    }
  }
}

init().catch((err) => showError(err instanceof Error ? err.message : String(err)));

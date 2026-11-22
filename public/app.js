/**
 * SkillBridge front end: upload/paste/sample CV -> What-If simulation, tutorials, and job matches.
 */

import { analyzeSkillGaps } from "/js/gap.js";

const MAX_PDF_BYTES = 3.2 * 1024 * 1024; // Keeps base64 JSON payload safely under Vercel's 4.5 MB limit

const $ = (id) => document.getElementById(id);

const els = {
  uploadView: $("uploadView"),
  loadingView: $("loadingView"),
  resultView: $("resultView"),
  restartBtn: $("restartBtn"),
  dropZone: $("dropZone"),
  cvInput: $("cvInput"),
  roleInput: $("roleInput"),
  citySelect: $("citySelect"),
  togglePasteBtn: $("togglePasteBtn"),
  pastePanel: $("pastePanel"),
  pasteInput: $("pasteInput"),
  analyzePasteBtn: $("analyzePasteBtn"),
  sampleBtns: $("sampleBtns"),
  errorBox: $("errorBox"),
  loadingFile: $("loadingFile"),
  resultMeta: $("resultMeta"),
  resultHeadline: $("resultHeadline"),
  scoreBar: $("scoreBar"),
  scoreText: $("scoreText"),
  scoreBoost: $("scoreBoost"),
  resultNotice: $("resultNotice"),
  yourSkills: $("yourSkills"),
  resetSimBtn: $("resetSimBtn"),
  todoList: $("todoList"),
  jobFilterInput: $("jobFilterInput"),
  readyJobs: $("readyJobs"),
  readyCount: $("readyCount"),
  almostBlock: $("almostBlock"),
  almostJobs: $("almostJobs"),
  almostCount: $("almostCount"),
};

let result = null;
let presets = [];
let simulatedSkills = new Set();
let stepTimer = null;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(url) {
  return /^https?:\/\//i.test(String(url || "")) ? url : "";
}

async function readApiResponse(res) {
  const raw = await res.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}. Please try again or paste your CV text.`);
      }
      throw new Error("Unexpected response from server.");
    }
  }
  if (!res.ok) {
    const err = new Error(data.error || `Something went wrong (${res.status}).`);
    err.switchToPaste = Boolean(data.switchToPaste);
    throw err;
  }
  return data;
}

function show(view) {
  for (const v of [els.uploadView, els.loadingView, els.resultView]) {
    v.classList.toggle("hidden", v !== view);
  }
  els.restartBtn.classList.toggle("hidden", view !== els.resultView);
  window.scrollTo({ top: 0 });
}

function showError(msg) {
  els.errorBox.textContent = msg;
  els.errorBox.classList.toggle("hidden", !msg);
}

function openPastePanel(focus = true) {
  els.pastePanel.classList.remove("hidden");
  els.togglePasteBtn.textContent = "Hide paste box";
  if (focus) els.pasteInput.focus();
}

function startSteps() {
  const items = [...els.loadingView.querySelectorAll(".steps li")];
  let i = 0;
  const paint = () =>
    items.forEach((li, idx) => {
      li.classList.toggle("done", idx < i);
      li.classList.toggle("active", idx === i);
    });
  paint();
  stepTimer = setInterval(() => {
    if (i < items.length - 1) {
      i += 1;
      paint();
    }
  }, 2200);
}

function stopSteps() {
  clearInterval(stepTimer);
  stepTimer = null;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

async function runAnalyzeRequest(bodyPayload, loadingLabel) {
  showError("");
  els.loadingFile.textContent = loadingLabel;
  show(els.loadingView);
  startSteps();

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "quick",
        role: els.roleInput.value.trim(),
        location: els.citySelect.value,
        ...bodyPayload,
      }),
    });
    const data = await readApiResponse(res);
    result = data;
    simulatedSkills = new Set();
    els.jobFilterInput.value = "";
    renderResult();
    show(els.resultView);
  } catch (err) {
    show(els.uploadView);
    if (err?.switchToPaste) {
      openPastePanel(true);
    }
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    stopSteps();
    els.cvInput.value = "";
  }
}

async function handleFile(file) {
  showError("");
  if (!file) return;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    showError("Please upload your CV as a PDF, or paste your resume text below.");
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    openPastePanel(true);
    showError("That PDF is over 3 MB. Please upload a smaller PDF or paste your resume text below.");
    return;
  }

  try {
    const pdfBase64 = await readAsDataUrl(file);
    await runAnalyzeRequest({ pdfBase64 }, file.name);
  } catch (err) {
    show(els.uploadView);
    showError(err instanceof Error ? err.message : String(err));
  }
}

function pills(skills, cls = "") {
  return skills.map((s) => `<span class="pill ${cls}">${esc(s)}</span>`).join("");
}

function headlineFor(score) {
  if (score >= 75) return "You're ready to apply.";
  if (score >= 50) return "You're close.";
  if (score >= 25) return "You're on your way.";
  return "Here's where to start.";
}

function sourceLabel(src) {
  if (src === "live") return "Live jobs";
  if (src === "demo") return "Sample dataset";
  return "Cached jobs";
}

function renderResult() {
  const { baseline, jobs, role, location, userSkills, coursesBySkill, data_source, offlineDemoNotice, demandList } = result;
  const simList = [...simulatedSkills];
  const current = simList.length
    ? analyzeSkillGaps({
        role,
        location,
        userSkills,
        jobs,
        demandList,
        simulatedSkills: simList,
      })
    : baseline;

  const baseScore = Number(baseline.readiness_score || 0);
  const score = Number(current.readiness_score || 0);
  const boost = Math.round(score - baseScore);
  const newlyReadyCount = current.ready_jobs.length - baseline.ready_jobs.length;

  els.resultMeta.textContent = `${role} · ${location} · ${jobs.length} openings · ${sourceLabel(data_source)}`;
  els.resultHeadline.textContent = headlineFor(score);
  els.scoreBar.style.width = `${Math.max(2, Math.min(100, score))}%`;
  els.scoreText.textContent = `${Math.round(score)}% match`;

  if (simList.length > 0) {
    els.scoreBoost.textContent = `+${Math.max(0, boost)}% · +${Math.max(0, newlyReadyCount)} ready`;
    els.scoreBoost.classList.remove("hidden");
  } else {
    els.scoreBoost.classList.add("hidden");
  }

  if (offlineDemoNotice) {
    els.resultNotice.textContent = offlineDemoNotice;
    els.resultNotice.classList.remove("hidden");
  } else {
    els.resultNotice.classList.add("hidden");
  }

  els.yourSkills.innerHTML = userSkills.length
    ? `<span class="pills-label">Found in your CV</span>${pills(userSkills)}${
        simList.length ? pills(simList.map((s) => `+ ${s}`), "pill-sim") : ""
      }`
    : `<span class="pills-label">We couldn't spot technical skills in your CV — add a clear "Skills" section.</span>`;

  els.resetSimBtn.classList.toggle("hidden", simList.length === 0);

  // What to learn next (always anchored to baseline top 5 so toggles stay stable)
  const gaps = baseline.missing_gaps.slice(0, 5);
  if (gaps.length === 0) {
    els.todoList.innerHTML = `<li class="todo-item"><div class="todo-body"><p class="todo-title">Nothing missing. Start applying below.</p></div></li>`;
  } else {
    els.todoList.innerHTML = gaps
      .map((gap, idx) => {
        const isSim = simulatedSkills.has(gap.skill);
        const extra = coursesBySkill?.[gap.skill] || {};
        const courses = (extra.courses || []).slice(0, 2).filter((c) => safeUrl(c.url));
        const links = courses.length
          ? `<div class="todo-links">${courses
              .map(
                (c) =>
                  `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title)} ↗</a>`
              )
              .join("")}</div>`
          : `<div class="todo-links"><button class="link-btn" data-skill="${esc(gap.skill)}" type="button">Find tutorials →</button></div>`;
        const project = extra.mini_project_idea
          ? `<p class="todo-project"><span class="mono">Weekend project</span> ${esc(extra.mini_project_idea)}</p>`
          : "";
        return `
          <li class="todo-item ${isSim ? "is-simulated" : ""}">
            <span class="todo-num mono">${String(idx + 1).padStart(2, "0")}</span>
            <div class="todo-body">
              <div class="todo-top">
                <p class="todo-title">Learn <strong>${esc(gap.skill)}</strong></p>
                <button class="sim-toggle ${isSim ? "active" : ""}" data-sim="${esc(gap.skill)}" type="button">
                  ${isSim ? "✓ Simulated" : "Simulate"}
                </button>
              </div>
              <p class="todo-why">Asked for in ${gap.jobs_unlocked} of ${jobs.length} jobs${
                gap.net_ready_unlocked > 0
                  ? ` · makes you ready for ${gap.net_ready_unlocked} more`
                  : ""
              }</p>
              ${project}
              ${links}
            </div>
          </li>`;
      })
      .join("");
  }

  els.todoList.querySelectorAll("[data-skill]").forEach((btn) => {
    btn.addEventListener("click", () => loadCourses(btn.dataset.skill, btn));
  });
  els.todoList.querySelectorAll("[data-sim]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sk = btn.dataset.sim;
      if (simulatedSkills.has(sk)) simulatedSkills.delete(sk);
      else simulatedSkills.add(sk);
      renderResult();
    });
  });

  // Jobs
  const effectiveSet = new Set([...userSkills, ...simList]);
  const baselineReadyIds = new Set(baseline.ready_jobs.map((j) => j.job_id));
  const query = els.jobFilterInput.value.trim().toLowerCase();
  const matchesFilter = (job) => {
    if (!query) return true;
    return [job.title, job.company, job.location, ...(job.extracted_skills || [])]
      .join(" ")
      .toLowerCase()
      .includes(query);
  };

  const totalJobsCount = current.ready_jobs.length + current.almost_ready_jobs.length;
  els.jobFilterInput.classList.toggle("hidden", totalJobsCount < 3 && !query);

  const readyFiltered = current.ready_jobs.filter(matchesFilter);
  const almostFiltered = current.almost_ready_jobs.filter(matchesFilter);

  els.readyCount.textContent = readyFiltered.length;
  els.readyJobs.innerHTML = readyFiltered.length
    ? readyFiltered
        .map((j) =>
          jobCard(j, effectiveSet, true, simList.length > 0 && !baselineReadyIds.has(j.job_id))
        )
        .join("")
    : `<p class="empty">No exact matches yet — toggle <strong>Simulate</strong> on a skill above or learn the #1 skill to unlock roles.</p>`;

  els.almostCount.textContent = almostFiltered.length;
  els.almostBlock.classList.toggle("hidden", almostFiltered.length === 0 && !query);
  els.almostJobs.innerHTML = almostFiltered
    .map((j) => jobCard(j, effectiveSet, false, false))
    .join("");
}

function jobCard(job, effectiveSet, ready, newlyUnlocked) {
  const skills = job.extracted_skills || [];
  const matchedCount = skills.filter((s) => effectiveSet.has(s)).length;
  const missing = skills.filter((s) => !effectiveSet.has(s));
  const url = safeUrl(job.apply_url);
  const matchNote = skills.length ? `${matchedCount}/${skills.length} skills` : "";
  const meta = [job.company, job.location, job.salary_text, matchNote]
    .filter(Boolean)
    .map(esc)
    .join(" · ");
  const missingHtml =
    !ready && missing.length
      ? `<p class="job-missing">Missing: ${missing.map(esc).join(", ")}</p>`
      : "";
  const unlockedTag = newlyUnlocked ? `<span class="job-tag">Unlocked</span>` : "";
  const action = url
    ? `<a class="btn btn-small ${ready ? "btn-primary" : "btn-ghost"}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ready ? "Apply" : "View"} →</a>`
    : "";
  return `
    <article class="job ${newlyUnlocked ? "job-unlocked" : ""}">
      <div class="job-main">
        <div class="job-title-row">
          <p class="job-title">${esc(job.title)}</p>
          ${unlockedTag}
        </div>
        <p class="job-meta">${meta}</p>
        ${missingHtml}
      </div>
      ${action}
    </article>`;
}

async function loadCourses(skill, btn) {
  btn.disabled = true;
  btn.textContent = "Finding…";
  try {
    const res = await fetch("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill, role: result.role }),
    });
    const data = await readApiResponse(res);
    result.coursesBySkill = result.coursesBySkill || {};
    result.coursesBySkill[skill] = {
      ...(result.coursesBySkill[skill] || {}),
      courses: data.courses || [],
      mini_project_idea: data.mini_project_idea || result.coursesBySkill[skill]?.mini_project_idea || "",
    };
    if (!(data.courses || []).length) {
      btn.textContent = "No tutorials found";
      return;
    }
    renderResult();
  } catch {
    btn.disabled = false;
    btn.textContent = "Try again →";
  }
}

async function initPresets() {
  try {
    const res = await fetch("/api/presets");
    const data = await readApiResponse(res);
    presets = Array.isArray(data.presets) ? data.presets : [];
    const cities = Array.isArray(data.cities) ? data.cities : [];
    if (cities.length) {
      els.citySelect.innerHTML = cities
        .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
        .join("");
    }
    els.sampleBtns.innerHTML = presets
      .slice(0, 3)
      .map((p, idx) => {
        const shortName = p.role.replace(" Developer", "").replace("Python ", "");
        return `<button class="chip-btn" data-preset-idx="${idx}" type="button" title="${esc(p.label)}">${esc(shortName)}</button>`;
      })
      .join("");

    els.sampleBtns.querySelectorAll("[data-preset-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = presets[Number(btn.dataset.presetIdx)];
        if (!p) return;
        if (!els.roleInput.value.trim()) els.roleInput.value = p.role;
        runAnalyzeRequest(
          {
            resumeText: p.text,
            role: els.roleInput.value.trim() || p.role,
            location: els.citySelect.value || p.city,
          },
          p.label
        );
      });
    });
  } catch {
    // Non-fatal; PDF and paste still work
  }
}

// Wiring
els.cvInput.addEventListener("change", (e) => handleFile(e.target.files?.[0]));

["dragenter", "dragover"].forEach((type) =>
  els.dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropZone.classList.add("is-over");
  })
);
["dragleave", "drop"].forEach((type) =>
  els.dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropZone.classList.remove("is-over");
  })
);
els.dropZone.addEventListener("drop", (e) => handleFile(e.dataTransfer?.files?.[0]));

els.togglePasteBtn.addEventListener("click", () => {
  const isHidden = els.pastePanel.classList.contains("hidden");
  if (isHidden) {
    openPastePanel(true);
  } else {
    els.pastePanel.classList.add("hidden");
    els.togglePasteBtn.textContent = "Or paste resume text →";
  }
});

els.analyzePasteBtn.addEventListener("click", () => {
  const text = els.pasteInput.value.trim();
  if (text.length < 20) {
    showError("Please paste at least 20 characters of your resume text.");
    els.pasteInput.focus();
    return;
  }
  runAnalyzeRequest({ resumeText: text }, "Pasted resume text");
});

els.resetSimBtn.addEventListener("click", () => {
  simulatedSkills.clear();
  renderResult();
});

els.jobFilterInput.addEventListener("input", () => {
  if (result) renderResult();
});

els.restartBtn.addEventListener("click", () => {
  result = null;
  simulatedSkills.clear();
  showError("");
  show(els.uploadView);
});

initPresets();

/**
 * SkillBridge front end: upload a CV, then show what to learn and where to apply.
 */

const $ = (id) => document.getElementById(id);

const els = {
  uploadView: $("uploadView"),
  loadingView: $("loadingView"),
  resultView: $("resultView"),
  restartBtn: $("restartBtn"),
  dropZone: $("dropZone"),
  cvInput: $("cvInput"),
  errorBox: $("errorBox"),
  loadingFile: $("loadingFile"),
  resultMeta: $("resultMeta"),
  resultHeadline: $("resultHeadline"),
  scoreBar: $("scoreBar"),
  scoreText: $("scoreText"),
  yourSkills: $("yourSkills"),
  todoList: $("todoList"),
  readyJobs: $("readyJobs"),
  readyCount: $("readyCount"),
  almostBlock: $("almostBlock"),
  almostJobs: $("almostJobs"),
  almostCount: $("almostCount"),
};

let result = null;
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

async function handleFile(file) {
  showError("");
  if (!file) return;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    showError("Please upload your CV as a PDF.");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showError("That file is over 8 MB. Please upload a smaller PDF.");
    return;
  }

  els.loadingFile.textContent = file.name;
  show(els.loadingView);
  startSteps();

  try {
    const pdfBase64 = await readAsDataUrl(file);
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "quick", pdfBase64 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
    result = data;
    renderResult();
    show(els.resultView);
  } catch (err) {
    show(els.uploadView);
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    stopSteps();
    els.cvInput.value = "";
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

function renderResult() {
  const { baseline, jobs, role, location, userSkills, coursesBySkill } = result;
  const score = Number(baseline.readiness_score || 0);

  els.resultMeta.textContent = `${role} · ${location} · ${jobs.length} openings checked`;
  els.resultHeadline.textContent = headlineFor(score);
  els.scoreBar.style.width = `${Math.max(2, Math.min(100, score))}%`;
  els.scoreText.textContent = `${Math.round(score)}% match`;
  els.yourSkills.innerHTML = userSkills.length
    ? `<span class="pills-label">Found in your CV</span>${pills(userSkills)}`
    : `<span class="pills-label">We couldn't spot technical skills in your CV — add a clear "Skills" section.</span>`;

  // What to learn next
  const gaps = baseline.missing_gaps.slice(0, 5);
  if (gaps.length === 0) {
    els.todoList.innerHTML = `<li class="todo-item"><div class="todo-body"><p class="todo-title">Nothing missing. Start applying below.</p></div></li>`;
  } else {
    els.todoList.innerHTML = gaps
      .map((gap, idx) => {
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
          <li class="todo-item">
            <span class="todo-num mono">${String(idx + 1).padStart(2, "0")}</span>
            <div class="todo-body">
              <p class="todo-title">Learn <strong>${esc(gap.skill)}</strong></p>
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

  // Jobs
  const userSet = new Set(userSkills);
  els.readyCount.textContent = baseline.ready_jobs.length;
  els.readyJobs.innerHTML = baseline.ready_jobs.length
    ? baseline.ready_jobs.map((j) => jobCard(j, userSet, true)).join("")
    : `<p class="empty">No exact matches yet — learning the first skill above is the fastest way to change that.</p>`;

  els.almostCount.textContent = baseline.almost_ready_jobs.length;
  els.almostBlock.classList.toggle("hidden", baseline.almost_ready_jobs.length === 0);
  els.almostJobs.innerHTML = baseline.almost_ready_jobs
    .map((j) => jobCard(j, userSet, false))
    .join("");
}

function jobCard(job, userSet, ready) {
  const missing = (job.extracted_skills || []).filter((s) => !userSet.has(s));
  const url = safeUrl(job.apply_url);
  const meta = [job.company, job.location, job.salary_text].filter(Boolean).map(esc).join(" · ");
  const missingHtml =
    !ready && missing.length
      ? `<p class="job-missing">Missing: ${missing.map(esc).join(", ")}</p>`
      : "";
  const action = url
    ? `<a class="btn btn-small ${ready ? "btn-primary" : "btn-ghost"}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ready ? "Apply" : "View"} →</a>`
    : "";
  return `
    <article class="job">
      <div class="job-main">
        <p class="job-title">${esc(job.title)}</p>
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
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load tutorials.");
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
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Try again →";
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

els.restartBtn.addEventListener("click", () => {
  result = null;
  showError("");
  show(els.uploadView);
});

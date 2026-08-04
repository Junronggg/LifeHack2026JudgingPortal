const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
const state = { user: null, dashboard: null, activeCategory: "recommended", activeAdminCategory: "all", selectedTeamId: null };

const icons = {
  arrow: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  back: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function toast(message) {
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  toastRegion.append(element);
  setTimeout(() => element.remove(), 3200);
}

function roleLabel(user) {
  if (user.role === "admin") return "Event administrator";
  return user.judgeType === "company" ? "Company judge" : "General judge";
}

function topbar() {
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark"><img src="/computing-club-logo.png" alt="NUS Computing Club"></span><span>LifeHack <em>2026</em></span></div>
    <div class="topbar-actions">
      <div class="user-chip"><strong>${escapeHtml(state.user.name)}</strong><span>${roleLabel(state.user)}</span></div>
      <button class="ghost-button" data-action="logout" type="button">Sign out</button>
    </div>
  </header>`;
}

function renderLogin() {
  app.innerHTML = `<main class="login-shell">
    <section class="login-visual" aria-label="LifeHack 2026">
      <div class="brand"><span class="brand-mark"><img src="/computing-club-logo.png" alt="NUS Computing Club"></span><span>LifeHack <em>2026</em></span></div>
      <div class="hero-copy">
        <p class="eyebrow">Judging portal</p>
        <h1>Ideas in motion.</h1>
        <p>Explore bold solutions, meet the teams behind them, and help select the projects that move us forward.</p>
      </div>
      <div class="event-meta"><div><strong>Open exhibition</strong>Browse by challenge</div><div><strong>Mobile first</strong>Score as you walk</div></div>
    </section>
    <section class="login-panel">
      <form class="login-card" id="login-form">
        <p class="eyebrow">Welcome back</p>
        <h2>Sign in to judge</h2>
        <p class="subtle">Use the account provided by the organising team.</p>
        <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" placeholder="you@example.com" required></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required></div>
        <div class="form-error" id="login-error" role="alert"></div>
        <button class="primary-button" type="submit">Continue to portal</button>
        <div class="demo-box"><p>Preview accounts</p><div class="demo-logins">
          <button class="demo-login" type="button" data-demo="judge">General judge</button>
          <button class="demo-login" type="button" data-demo="company">Company judge</button>
          <button class="demo-login" type="button" data-demo="admin">Administrator</button>
        </div></div>
      </form>
    </section>
  </main>`;
}

async function login(email, password) {
  const button = document.querySelector("#login-form .primary-button");
  const error = document.querySelector("#login-error");
  button.disabled = true;
  button.textContent = "Signing in…";
  error.textContent = "";
  try {
    const result = await request("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
    state.user = result.user;
    window.location.hash = result.user.role === "admin" ? "admin" : "judge";
    await loadDashboard();
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
    button.textContent = "Continue to portal";
  }
}

function teamCard(team) {
  const badges = [
    team.mandatory && !team.scored ? `<span class="badge mandatory">Required</span>` : "",
    team.recommended && !team.scored ? `<span class="badge recommended">Recommended</span>` : "",
    team.scored ? `<span class="badge scored">Scored</span>` : ""
  ].join("");
  return `<article class="team-card" data-team-card="${team.id}">
    <div class="team-card-top"><span class="table-label">${escapeHtml(team.table)}</span><span class="category-dot" style="background:${team.category.color}"></span></div>
    <div class="badges">${badges || `<span class="badge open">Open</span>`}</div>
    <h3>${escapeHtml(team.name)}</h3><p>${escapeHtml(team.summary)}</p>
    <div class="team-card-footer"><span class="coverage"><strong>${team.progress.count}</strong> / ${team.progress.required} judges</span>
      <button class="${team.scored ? "secondary-button" : "primary-button"}" data-score-team="${team.id}" type="button">${team.scored ? "Edit score" : "Score team"} ${icons.arrow}</button>
    </div>
  </article>`;
}

function renderJudge() {
  const { teams, categories, summary } = state.dashboard;
  let filtered = teams;
  if (state.activeCategory === "recommended") filtered = teams.filter(team => team.recommended || (team.mandatory && !team.scored));
  else if (state.activeCategory === "scored") filtered = teams.filter(team => team.scored);
  else if (state.activeCategory !== "all") filtered = teams.filter(team => team.categoryId === state.activeCategory);
  const total = teams.length;
  const percent = Math.round(summary.scored / total * 100);
  const companyCopy = state.user.judgeType === "company"
    ? `Your required ${escapeHtml(categories.find(c => c.id === state.user.companyCategoryId)?.name || "challenge")} teams are prioritised below.`
    : "Start with your recommendations to help every team reach the judging minimum.";
  app.innerHTML = `<div class="app-shell">${topbar()}<main class="main">
    <section class="page-heading"><div><p class="eyebrow">Judge dashboard</p><h1>Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${escapeHtml(state.user.name.split(" ").slice(-1)[0])}.</h1><p class="subtle">${companyCopy}</p></div>
      <div class="progress-ring" style="--progress:${percent}%"><div class="progress-ring-content"><strong>${summary.scored}</strong><span>scored</span></div></div>
    </section>
    <section class="stat-grid" aria-label="Judging overview">
      <div class="stat-card"><span>Scores submitted</span><strong>${summary.scored}</strong></div>
      <div class="stat-card"><span>${state.user.judgeType === "company" ? "Required remaining" : "Recommended next"}</span><strong>${state.user.judgeType === "company" ? summary.requiredRemaining : summary.recommendedRemaining}</strong></div>
      <div class="stat-card"><span>Teams available</span><strong>${total}</strong></div>
    </section>
    <section class="controls"><div><p class="eyebrow">Browse teams</p></div><div class="tabs" role="tablist" aria-label="Filter by challenge">
      ${[{id:"recommended",name:"For you"},{id:"all",name:"All teams"},...categories,{id:"scored",name:"Scored"}].map(category => `<button class="tab ${state.activeCategory === category.id ? "active" : ""}" data-category="${category.id}" role="tab" aria-selected="${state.activeCategory === category.id}">${escapeHtml(category.name)}</button>`).join("")}
    </div></section>
    <section class="team-grid">${filtered.length ? filtered.map(teamCard).join("") : `<div class="empty-state"><strong>You’re all caught up.</strong><br>Choose another challenge to keep exploring.</div>`}</section>
  </main></div>`;
}

function renderScore() {
  const team = state.dashboard.teams.find(item => item.id === state.selectedTeamId);
  if (!team) return renderJudge();
  const scores = team.scores || Object.fromEntries(state.dashboard.criteria.map(c => [c.id, 5]));
  app.innerHTML = `<div class="app-shell">${topbar()}<main class="main score-layout">
    <aside class="team-summary">
      <button class="back-link" data-action="back-to-teams" type="button">${icons.back} Back to teams</button>
      <span class="table-label">${escapeHtml(team.table)}</span><h1>${escapeHtml(team.name)}</h1><p>${escapeHtml(team.summary)}</p><hr>
      <dl><div><dt>Challenge</dt><dd>${escapeHtml(team.category.name)}</dd></div><div><dt>Presented for</dt><dd>${escapeHtml(team.category.company)}</dd></div><div><dt>Coverage</dt><dd>${team.progress.count} of ${team.progress.required} minimum judges</dd></div></dl>
    </aside>
    <form class="score-form" id="score-form" data-team-id="${team.id}">
      <div class="score-form-header"><div><h2>${team.scored ? "Review your score" : "Score this project"}</h2><p class="subtle">Move each slider from 0 to 10. The weighted total is calculated privately.</p></div><span class="autosave-note">● Draft kept on this device</span></div>
      ${state.dashboard.criteria.map(criterion => `<section class="criterion">
        <div class="criterion-head"><div><h3>${escapeHtml(criterion.name)}</h3><p>${escapeHtml(criterion.description)}</p></div><span class="weight">${criterion.weight}% weight</span></div>
        <div class="slider-row"><input type="range" min="0" max="10" step="1" value="${scores[criterion.id]}" name="${criterion.id}" aria-label="${escapeHtml(criterion.name)} score" style="--fill:${scores[criterion.id] * 10}%"><output class="score-value" for="${criterion.id}">${scores[criterion.id]}</output></div>
        <div class="scale-labels"><span>Needs work</span><span>Outstanding</span></div>
      </section>`).join("")}
      <div class="field"><label for="notes">Private notes <span class="subtle">(optional)</span></label><textarea id="notes" name="notes" maxlength="1000" placeholder="Add a short note for the organising team…">${escapeHtml(team.notes || "")}</textarea></div>
      <div class="form-error" id="score-error" role="alert"></div>
      <div class="form-actions"><button class="ghost-button" data-action="back-to-teams" type="button">Cancel</button><button class="primary-button" type="submit">${team.scored ? "Update score" : "Submit score"}</button></div>
    </form>
  </main></div>`;
  restoreDraft(team.id);
}

function renderAdmin() {
  const { teams, categories, summary } = state.dashboard;
  const filtered = state.activeAdminCategory === "all" ? teams : teams.filter(team => team.categoryId === state.activeAdminCategory);
  app.innerHTML = `<div class="app-shell">${topbar()}<main class="main">
    <section class="page-heading"><div><p class="eyebrow">Live operations</p><h1>Judging progress</h1><p class="subtle">Monitor coverage across every challenge. Scores remain private to the operations team.</p></div>
      <div class="progress-ring" style="--progress:${summary.coverage}%"><div class="progress-ring-content"><strong>${summary.coverage}%</strong><span>covered</span></div></div>
    </section>
    <section class="stat-grid"><div class="stat-card"><span>Teams complete</span><strong>${summary.completed} / ${summary.total}</strong></div><div class="stat-card"><span>Total submissions</span><strong>${summary.submissions}</strong></div><div class="stat-card"><span>Required per team</span><strong>${summary.minimumJudges}</strong></div></section>
    <section class="admin-toolbar"><h2>Team coverage</h2><div class="tabs" role="tablist" aria-label="Filter team coverage">${[{id:"all",name:"All challenges"},...categories].map(category => `<button class="tab ${state.activeAdminCategory === category.id ? "active" : ""}" data-admin-category="${category.id}" role="tab" aria-selected="${state.activeAdminCategory === category.id}">${escapeHtml(category.name)}</button>`).join("")}</div></section>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Team</th><th>Challenge</th><th>Coverage</th><th>Status</th><th>Average</th></tr></thead><tbody>
      ${filtered.map(team => `<tr><td class="team-cell"><strong>${escapeHtml(team.name)}</strong><span>${escapeHtml(team.table)}</span></td><td>${escapeHtml(team.category.name)}</td><td><div style="display:flex;align-items:center;gap:10px"><div class="mini-progress"><span style="width:${Math.min(100, team.judgeCount / team.required * 100)}%"></span></div><strong>${team.judgeCount}/${team.required}</strong></div></td><td><span class="status ${team.status}">${team.status.replace("-", " ")}</span></td><td>${team.averageScore === null ? "—" : `${team.averageScore} / 10`}</td></tr>`).join("")}
    </tbody></table></div>
  </main></div>`;
}

function saveDraft(teamId) {
  const form = document.querySelector("#score-form");
  if (!form) return;
  const draft = { notes: form.notes.value, scores: {} };
  state.dashboard.criteria.forEach(c => { draft.scores[c.id] = Number(form.elements[c.id].value); });
  localStorage.setItem(`lifehack-draft-${state.user.id}-${teamId}`, JSON.stringify(draft));
}

function restoreDraft(teamId) {
  const team = state.dashboard.teams.find(item => item.id === teamId);
  if (team.scored) return;
  try {
    const draft = JSON.parse(localStorage.getItem(`lifehack-draft-${state.user.id}-${teamId}`));
    if (!draft) return;
    const form = document.querySelector("#score-form");
    state.dashboard.criteria.forEach(c => {
      if (Number.isInteger(draft.scores?.[c.id])) {
        form.elements[c.id].value = draft.scores[c.id];
        form.elements[c.id].style.setProperty("--fill", `${draft.scores[c.id] * 10}%`);
        form.elements[c.id].nextElementSibling.value = draft.scores[c.id];
      }
    });
    form.notes.value = draft.notes || "";
  } catch { localStorage.removeItem(`lifehack-draft-${state.user.id}-${teamId}`); }
}

async function submitScore(form) {
  const teamId = form.dataset.teamId;
  const button = form.querySelector("button[type=submit]");
  const error = form.querySelector("#score-error");
  const scores = Object.fromEntries(state.dashboard.criteria.map(c => [c.id, Number(form.elements[c.id].value)]));
  button.disabled = true; button.textContent = "Submitting…"; error.textContent = "";
  try {
    await request(`/api/teams/${teamId}/score`, { method: "PUT", body: JSON.stringify({ scores, notes: form.notes.value }) });
    localStorage.removeItem(`lifehack-draft-${state.user.id}-${teamId}`);
    await loadDashboard(false);
    state.selectedTeamId = null;
    window.location.hash = "judge";
    renderJudge();
    toast("Score submitted successfully.");
  } catch (err) { error.textContent = err.message; button.disabled = false; button.textContent = "Submit score"; }
}

async function loadDashboard(render = true) {
  state.dashboard = await request(state.user.role === "admin" ? "/api/admin/dashboard" : "/api/judge/dashboard");
  if (render) route();
}

function route() {
  if (!state.user) return renderLogin();
  if (state.user.role === "admin") return renderAdmin();
  if (window.location.hash.startsWith("#score/") && state.selectedTeamId) return renderScore();
  renderJudge();
}

app.addEventListener("click", async event => {
  const demo = event.target.closest("[data-demo]");
  if (demo) {
    const credentials = { judge: ["judge@lifehack.test", "judge2026"], company: ["company@lifehack.test", "judge2026"], admin: ["admin@lifehack.test", "admin2026"] }[demo.dataset.demo];
    document.querySelector("#email").value = credentials[0]; document.querySelector("#password").value = credentials[1];
    return;
  }
  const category = event.target.closest("[data-category]");
  if (category) { state.activeCategory = category.dataset.category; return renderJudge(); }
  const adminCategory = event.target.closest("[data-admin-category]");
  if (adminCategory) { state.activeAdminCategory = adminCategory.dataset.adminCategory; return renderAdmin(); }
  const scoreButton = event.target.closest("[data-score-team]");
  if (scoreButton) { state.selectedTeamId = scoreButton.dataset.scoreTeam; window.location.hash = `score/${state.selectedTeamId}`; return renderScore(); }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "back-to-teams") { state.selectedTeamId = null; window.location.hash = "judge"; return renderJudge(); }
  if (action === "logout") {
    await request("/api/logout", { method: "POST", body: "{}" });
    state.user = null; state.dashboard = null; window.location.hash = ""; renderLogin();
  }
});

app.addEventListener("input", event => {
  if (event.target.matches('input[type="range"]')) {
    event.target.style.setProperty("--fill", `${event.target.value * 10}%`);
    event.target.nextElementSibling.value = event.target.value;
    saveDraft(event.target.closest("form").dataset.teamId);
  }
  if (event.target.matches("textarea[name=notes]")) saveDraft(event.target.closest("form").dataset.teamId);
});

app.addEventListener("submit", event => {
  event.preventDefault();
  if (event.target.id === "login-form") return login(event.target.email.value, event.target.password.value);
  if (event.target.id === "score-form") return submitScore(event.target);
});

window.addEventListener("hashchange", route);

(async function init() {
  app.innerHTML = `<div class="loading">Preparing the judging floor…</div>`;
  try {
    const session = await request("/api/session");
    state.user = session.user;
    if (state.user) await loadDashboard(); else renderLogin();
  } catch { renderLogin(); }
})();

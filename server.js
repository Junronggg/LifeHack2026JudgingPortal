const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { criteria, categories, teams, users } = require("./seed");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const MIN_JUDGES = Number(process.env.MIN_JUDGES || 3);
const SESSION_TTL = 12 * 60 * 60 * 1000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "scores.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const sessions = new Map();

function loadScores() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read score data:", error.message);
    return [];
  }
}

let submissions = loadScores();

function persistScores() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(submissions, null, 2));
  fs.renameSync(temporary, DATA_FILE);
}

function send(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extraHeaders
  });
  res.end(body);
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map(part => part.trim().split("=")).filter(pair => pair.length === 2).map(([key, value]) => [key, decodeURIComponent(value)]));
}

function safeUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

function passwordsMatch(expected, supplied) {
  const expectedBuffer = Buffer.from(String(expected));
  const suppliedBuffer = Buffer.from(String(supplied));
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).judging_session;
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return users.find(user => user.id === session.userId) || null;
}

function requireUser(req, res, role) {
  const user = currentUser(req);
  if (!user) {
    send(res, 401, { error: "Please sign in to continue." });
    return null;
  }
  if (role && user.role !== role) {
    send(res, 403, { error: "You do not have access to this area." });
    return null;
  }
  return user;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON body.")); }
    });
    req.on("error", reject);
  });
}

function teamProgress(teamId) {
  const entries = submissions.filter(item => item.teamId === teamId);
  return { count: entries.length, required: MIN_JUDGES, complete: entries.length >= MIN_JUDGES };
}

function teamForJudge(team, user) {
  const category = categories.find(item => item.id === team.categoryId);
  const ownSubmission = submissions.find(item => item.teamId === team.id && item.judgeId === user.id);
  const progress = teamProgress(team.id);
  const mandatory = user.judgeType === "company" && user.companyCategoryId === team.categoryId;
  return {
    ...team,
    category,
    mandatory,
    scored: Boolean(ownSubmission),
    progress: { count: progress.count, required: progress.required },
    scores: ownSubmission ? ownSubmission.scores : null,
    notes: ownSubmission ? ownSubmission.notes : ""
  };
}

function recommendedIds(user) {
  const unscored = teams.filter(team => !submissions.some(item => item.teamId === team.id && item.judgeId === user.id));
  if (user.judgeType === "company") {
    return unscored.filter(team => team.categoryId === user.companyCategoryId).map(team => team.id);
  }
  return unscored
    .map(team => ({ team, count: teamProgress(team.id).count }))
    .filter(item => item.count < MIN_JUDGES)
    .sort((a, b) => a.count - b.count || a.team.table.localeCompare(b.team.table))
    .slice(0, 6)
    .map(item => item.team.id);
}

function computeWeightedScore(scores) {
  return criteria.reduce((total, criterion) => total + scores[criterion.id] * criterion.weight / 100, 0);
}

async function api(req, res, pathname) {
  if (pathname === "/api/session" && req.method === "GET") {
    return send(res, 200, { user: safeUser(currentUser(req)) });
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const user = users.find(item => item.email.toLowerCase() === email && passwordsMatch(item.password, body.password || ""));
    if (!user) return send(res, 401, { error: "Email or password is incorrect." });
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL });
    return send(res, 200, { user: safeUser(user) }, { "Set-Cookie": `judging_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}` });
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    const token = parseCookies(req.headers.cookie).judging_session;
    if (token) sessions.delete(token);
    return send(res, 200, { ok: true }, { "Set-Cookie": "judging_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }

  if (pathname === "/api/judge/dashboard" && req.method === "GET") {
    const user = requireUser(req, res, "judge");
    if (!user) return;
    const recommended = recommendedIds(user);
    const judgeTeams = teams.map(team => ({ ...teamForJudge(team, user), recommended: recommended.includes(team.id) }));
    return send(res, 200, {
      user: safeUser(user), categories, criteria,
      teams: judgeTeams,
      summary: {
        scored: judgeTeams.filter(team => team.scored).length,
        requiredRemaining: judgeTeams.filter(team => team.mandatory && !team.scored).length,
        recommendedRemaining: recommended.length
      }
    });
  }

  const scoreMatch = pathname.match(/^\/api\/teams\/([^/]+)\/score$/);
  if (scoreMatch && req.method === "PUT") {
    const user = requireUser(req, res, "judge");
    if (!user) return;
    const team = teams.find(item => item.id === scoreMatch[1]);
    if (!team) return send(res, 404, { error: "Team not found." });
    const body = await readBody(req);
    const scores = {};
    for (const criterion of criteria) {
      const value = Number(body.scores?.[criterion.id]);
      if (!Number.isInteger(value) || value < 0 || value > 10) return send(res, 400, { error: `Score for ${criterion.name} must be a whole number from 0 to 10.` });
      scores[criterion.id] = value;
    }
    const notes = String(body.notes || "").trim().slice(0, 1000);
    const existingIndex = submissions.findIndex(item => item.teamId === team.id && item.judgeId === user.id);
    const submission = { teamId: team.id, judgeId: user.id, scores, notes, weightedScore: Number(computeWeightedScore(scores).toFixed(2)), submittedAt: new Date().toISOString() };
    if (existingIndex >= 0) submissions[existingIndex] = submission;
    else submissions.push(submission);
    persistScores();
    return send(res, 200, { ok: true, submittedAt: submission.submittedAt });
  }

  if (pathname === "/api/admin/dashboard" && req.method === "GET") {
    const user = requireUser(req, res, "admin");
    if (!user) return;
    const teamRows = teams.map(team => {
      const entries = submissions.filter(item => item.teamId === team.id);
      const average = entries.length ? entries.reduce((sum, item) => sum + item.weightedScore, 0) / entries.length : null;
      return {
        ...team,
        category: categories.find(item => item.id === team.categoryId),
        judgeCount: entries.length,
        required: MIN_JUDGES,
        status: entries.length >= MIN_JUDGES ? "complete" : entries.length ? "in-progress" : "not-started",
        averageScore: average === null ? null : Number(average.toFixed(2)),
        judges: entries.map(entry => ({ name: users.find(item => item.id === entry.judgeId)?.name || "Unknown", submittedAt: entry.submittedAt }))
      };
    });
    const completed = teamRows.filter(team => team.status === "complete").length;
    return send(res, 200, {
      user: safeUser(user), categories, teams: teamRows,
      summary: { completed, total: teams.length, submissions: submissions.length, coverage: Math.round(completed / teams.length * 100), minimumJudges: MIN_JUDGES }
    });
  }

  send(res, 404, { error: "Endpoint not found." });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const resolved = path.resolve(PUBLIC_DIR, requested);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== path.join(PUBLIC_DIR, "index.html")) return send(res, 403, { error: "Forbidden" });
  fs.readFile(resolved, (error, content) => {
    if (error) {
      if (path.extname(requested)) return send(res, 404, { error: "File not found." });
      return fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) return send(res, 500, { error: "Application unavailable." });
        res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] }); res.end(fallback);
      });
    }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(resolved)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  try {
    if (pathname.startsWith("/api/")) await api(req, res, pathname);
    else if (req.method === "GET") serveStatic(res, pathname);
    else send(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) send(res, error.message === "Invalid JSON body." ? 400 : 500, { error: error.message === "Invalid JSON body." ? error.message : "Something went wrong." });
  }
});

if (require.main === module) server.listen(PORT, HOST, () => console.log(`LifeHack judging portal running at http://${HOST}:${PORT}`));

module.exports = { server, computeWeightedScore, recommendedIds };

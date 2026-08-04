import { categories, computeWeightedScore, criteria, teams } from "./config.mjs";

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MAX_BODY_BYTES = 1_000_000;
const COOKIE_NAME = "judging_session";
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store"
};
const CONTENT_SECURITY_POLICY = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

function json(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, { status, headers: { ...SECURITY_HEADERS, ...extraHeaders } });
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    judgeType: user.judge_type,
    companyCategoryId: user.company_category_id
  };
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function sha256(value) {
  const encoded = new TextEncoder().encode(value);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)));
}

export async function verifyPassword(password, saltBase64, expectedHashBase64, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(saltBase64), iterations },
    key,
    256
  );
  return constantTimeEqual(new Uint8Array(bits), base64ToBytes(expectedHashBase64));
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) throw new ApiError(413, "Request body is too large.");
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body.");
  }
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assertSameOrigin(request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Cross-origin request blocked.");
}

async function currentUser(request, env) {
  const token = parseCookies(request.headers.get("cookie"))[COOKIE_NAME];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const user = await env.DB.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.judge_type, u.company_category_id
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
  `).bind(tokenHash, now).first();
  if (!user) env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run().catch(() => {});
  return user || null;
}

async function requireUser(request, env, role) {
  const user = await currentUser(request, env);
  if (!user) throw new ApiError(401, "Please sign in to continue.");
  if (role && user.role !== role) throw new ApiError(403, "You do not have access to this area.");
  return user;
}

async function scoreRows(env) {
  const result = await env.DB.prepare(`
    SELECT team_id, judge_id, impact, innovation, execution, presentation, notes, weighted_score, submitted_at
    FROM scores
  `).all();
  return result.results || [];
}

function progressFor(teamId, rows, required) {
  const count = rows.filter(row => row.team_id === teamId).length;
  return { count, required, complete: count >= required };
}

function recommendations(user, rows, required) {
  const unscored = teams.filter(team => !rows.some(row => row.team_id === team.id && row.judge_id === user.id));
  if (user.judge_type === "company") {
    return unscored.filter(team => team.categoryId === user.company_category_id).map(team => team.id);
  }
  return unscored
    .map(team => ({ team, count: progressFor(team.id, rows, required).count }))
    .filter(item => item.count < required)
    .sort((a, b) => a.count - b.count || a.team.table.localeCompare(b.team.table))
    .slice(0, 6)
    .map(item => item.team.id);
}

async function login(request, env) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const user = await env.DB.prepare(`
    SELECT id, name, email, password_hash, password_salt, password_iterations, role, judge_type, company_category_id, active
    FROM users WHERE email = ? COLLATE NOCASE LIMIT 1
  `).bind(email).first();
  const valid = user?.active === 1 && await verifyPassword(
    String(body.password || ""),
    user.password_salt,
    user.password_hash,
    user.password_iterations
  );
  if (!valid) throw new ApiError(401, "Email or password is incorrect.");

  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(tokenHash, user.id, now, now + SESSION_TTL_SECONDS)
  ]);
  return json(
    { user: safeUser(user) },
    200,
    { "Set-Cookie": `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}` }
  );
}

async function logout(request, env) {
  const token = parseCookies(request.headers.get("cookie"))[COOKIE_NAME];
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json(
    { ok: true },
    200,
    { "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` }
  );
}

async function judgeDashboard(request, env) {
  const user = await requireUser(request, env, "judge");
  const rows = await scoreRows(env);
  const required = Math.max(1, Number(env.MIN_JUDGES || 3));
  const recommended = recommendations(user, rows, required);
  const judgeTeams = teams.map(team => {
    const category = categories.find(item => item.id === team.categoryId);
    const own = rows.find(row => row.team_id === team.id && row.judge_id === user.id);
    const progress = progressFor(team.id, rows, required);
    return {
      ...team,
      category,
      mandatory: user.judge_type === "company" && user.company_category_id === team.categoryId,
      scored: Boolean(own),
      recommended: recommended.includes(team.id),
      progress: { count: progress.count, required: progress.required },
      scores: own ? {
        impact: own.impact,
        innovation: own.innovation,
        execution: own.execution,
        presentation: own.presentation
      } : null,
      notes: own?.notes || ""
    };
  });
  return json({
    user: safeUser(user),
    categories,
    criteria,
    teams: judgeTeams,
    summary: {
      scored: judgeTeams.filter(team => team.scored).length,
      requiredRemaining: judgeTeams.filter(team => team.mandatory && !team.scored).length,
      recommendedRemaining: recommended.length
    }
  });
}

async function saveScore(request, env, teamId) {
  const user = await requireUser(request, env, "judge");
  const team = teams.find(item => item.id === teamId);
  if (!team) throw new ApiError(404, "Team not found.");
  const body = await readJson(request);
  const scores = {};
  for (const criterion of criteria) {
    const value = Number(body.scores?.[criterion.id]);
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      throw new ApiError(400, `Score for ${criterion.name} must be a whole number from 0 to 10.`);
    }
    scores[criterion.id] = value;
  }
  const notes = String(body.notes || "").trim().slice(0, 1000);
  const weightedScore = Number(computeWeightedScore(scores).toFixed(2));
  const submittedAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO scores (
      team_id, judge_id, impact, innovation, execution, presentation, notes, weighted_score, submitted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id, judge_id) DO UPDATE SET
      impact = excluded.impact,
      innovation = excluded.innovation,
      execution = excluded.execution,
      presentation = excluded.presentation,
      notes = excluded.notes,
      weighted_score = excluded.weighted_score,
      submitted_at = excluded.submitted_at
  `).bind(
    team.id,
    user.id,
    scores.impact,
    scores.innovation,
    scores.execution,
    scores.presentation,
    notes,
    weightedScore,
    submittedAt
  ).run();
  return json({ ok: true, submittedAt });
}

async function adminDashboard(request, env) {
  const user = await requireUser(request, env, "admin");
  const rows = await scoreRows(env);
  const required = Math.max(1, Number(env.MIN_JUDGES || 3));
  const judgeIds = [...new Set(rows.map(row => row.judge_id))];
  const judgeNames = new Map();
  if (judgeIds.length) {
    const placeholders = judgeIds.map(() => "?").join(",");
    const result = await env.DB.prepare(`SELECT id, name FROM users WHERE id IN (${placeholders})`).bind(...judgeIds).all();
    for (const judge of result.results || []) judgeNames.set(judge.id, judge.name);
  }
  const teamRows = teams.map(team => {
    const entries = rows.filter(row => row.team_id === team.id);
    const average = entries.length ? entries.reduce((sum, entry) => sum + entry.weighted_score, 0) / entries.length : null;
    return {
      ...team,
      category: categories.find(item => item.id === team.categoryId),
      judgeCount: entries.length,
      required,
      status: entries.length >= required ? "complete" : entries.length ? "in-progress" : "not-started",
      averageScore: average === null ? null : Number(average.toFixed(2)),
      judges: entries.map(entry => ({ name: judgeNames.get(entry.judge_id) || "Unknown", submittedAt: entry.submitted_at }))
    };
  });
  const completed = teamRows.filter(team => team.status === "complete").length;
  return json({
    user: safeUser(user),
    categories,
    teams: teamRows,
    summary: {
      completed,
      total: teams.length,
      submissions: rows.length,
      coverage: Math.round(completed / teams.length * 100),
      minimumJudges: required
    }
  });
}

export async function handleApi(request, env) {
  assertSameOrigin(request);
  const { pathname } = new URL(request.url);
  if (pathname === "/api/health" && request.method === "GET") return json({ ok: true });
  if (pathname === "/api/session" && request.method === "GET") return json({ user: safeUser(await currentUser(request, env)) });
  if (pathname === "/api/login" && request.method === "POST") return login(request, env);
  if (pathname === "/api/logout" && request.method === "POST") return logout(request, env);
  if (pathname === "/api/judge/dashboard" && request.method === "GET") return judgeDashboard(request, env);
  if (pathname === "/api/admin/dashboard" && request.method === "GET") return adminDashboard(request, env);
  const scoreMatch = pathname.match(/^\/api\/teams\/([^/]+)\/score$/);
  if (scoreMatch && request.method === "PUT") return saveScore(request, env, decodeURIComponent(scoreMatch[1]));
  throw new ApiError(404, "Endpoint not found.");
}

async function serveAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const pathname = new URL(request.url).pathname;
  headers.set("Cache-Control", pathname === "/" || pathname.endsWith(".html") ? "no-store" : "public, max-age=3600");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname.startsWith("/api/")) return await handleApi(request, env);
      return await serveAsset(request, env);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error("Unhandled Worker error", error);
      return json({ error: "Something went wrong." }, 500);
    }
  }
};

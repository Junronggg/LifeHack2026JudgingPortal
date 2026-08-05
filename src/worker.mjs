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

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function base64UrlToBytes(value) {
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  return base64ToBytes(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
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

function usersFromEnv(env) {
  try {
    const users = JSON.parse(env.USERS_JSON);
    if (!Array.isArray(users)) throw new Error("not an array");
    return users;
  } catch {
    throw new ApiError(500, "User accounts are not configured.");
  }
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    judgeType: user.judgeType || null,
    companyCategoryId: user.companyCategoryId || null
  };
}

async function createSession(user, env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ sub: user.id, iat: now, exp: now + SESSION_TTL_SECONDS })));
  const signature = bytesToBase64Url(await hmac(payload, env.SESSION_SECRET));
  return `${payload}.${signature}`;
}

async function verifySession(token, env) {
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = await hmac(payload, env.SESSION_SECRET);
  let supplied;
  try { supplied = base64UrlToBytes(signature); } catch { return null; }
  if (!constantTimeEqual(expected, supplied)) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    if (!session.sub || !Number.isInteger(session.exp) || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

async function currentUser(request, env) {
  const session = await verifySession(parseCookies(request.headers.get("cookie"))[COOKIE_NAME], env);
  if (!session) return null;
  return usersFromEnv(env).find(user => user.id === session.sub && user.active !== false) || null;
}

async function requireUser(request, env, role) {
  const user = await currentUser(request, env);
  if (!user) throw new ApiError(401, "Please sign in to continue.");
  if (role && user.role !== role) throw new ApiError(403, "You do not have access to this area.");
  return user;
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) throw new ApiError(413, "Request body is too large.");
  try { return await request.json(); }
  catch { throw new ApiError(400, "Invalid JSON body."); }
}

function assertSameOrigin(request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Cross-origin request blocked.");
}

async function sheetsRequest(env, action, data = null) {
  if (!env.SHEETS_WEB_APP_URL || !env.SHEETS_SHARED_SECRET) throw new ApiError(500, "Google Sheets is not configured.");
  const payload = JSON.stringify({
    timestamp: Date.now(),
    nonce: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18))),
    action,
    data
  });
  const signature = bytesToBase64Url(await hmac(payload, env.SHEETS_SHARED_SECRET));
  let response;
  try {
    response = await fetch(env.SHEETS_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ payload, signature }),
      redirect: "follow"
    });
  } catch {
    throw new ApiError(502, "The score service is temporarily unavailable. Please try again.");
  }
  let result;
  try { result = await response.json(); }
  catch { throw new ApiError(502, "The score service returned an invalid response."); }
  if (!response.ok || !result.ok) throw new ApiError(502, result.error || "The score service rejected the request.");
  return result.data;
}

async function scoreRows(env) {
  const rows = await sheetsRequest(env, "snapshot");
  return Array.isArray(rows) ? rows : [];
}

function progressFor(teamId, rows, required) {
  const count = rows.filter(row => row.team_id === teamId).length;
  return { count, required, complete: count >= required };
}

function recommendations(user, rows, required) {
  const unscored = teams.filter(team => !rows.some(row => row.team_id === team.id && row.judge_id === user.id));
  if (user.judgeType === "company") {
    return unscored.filter(team => team.categoryId === user.companyCategoryId).map(team => team.id);
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
  const user = usersFromEnv(env).find(item => item.email.toLowerCase() === email);
  const valid = user?.active !== false && await verifyPassword(
    String(body.password || ""),
    user.passwordSalt,
    user.passwordHash,
    user.passwordIterations
  );
  if (!valid) throw new ApiError(401, "Email or password is incorrect.");
  const token = await createSession(user, env);
  return json(
    { user: safeUser(user) },
    200,
    { "Set-Cookie": `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}` }
  );
}

function logout() {
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
      mandatory: user.judgeType === "company" && user.companyCategoryId === team.categoryId,
      scored: Boolean(own),
      recommended: recommended.includes(team.id),
      progress: { count: progress.count, required: progress.required },
      scores: own ? {
        impact: Number(own.impact),
        innovation: Number(own.innovation),
        execution: Number(own.execution),
        presentation: Number(own.presentation)
      } : null,
      notes: own?.notes || ""
    };
  });
  return json({
    user: safeUser(user), categories, criteria, teams: judgeTeams,
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
  const category = categories.find(item => item.id === team.categoryId);
  await sheetsRequest(env, "submit", {
    event_id: crypto.randomUUID(),
    submitted_at: submittedAt,
    team_id: team.id,
    team_name: team.name,
    category_id: team.categoryId,
    category_name: category.name,
    table: team.table,
    judge_id: user.id,
    judge_name: user.name,
    impact: scores.impact,
    innovation: scores.innovation,
    execution: scores.execution,
    presentation: scores.presentation,
    weighted_score: weightedScore,
    notes
  });
  return json({ ok: true, submittedAt });
}

async function adminDashboard(request, env) {
  const user = await requireUser(request, env, "admin");
  const rows = await scoreRows(env);
  const required = Math.max(1, Number(env.MIN_JUDGES || 3));
  const teamRows = teams.map(team => {
    const entries = rows.filter(row => row.team_id === team.id);
    const average = entries.length ? entries.reduce((sum, entry) => sum + Number(entry.weighted_score), 0) / entries.length : null;
    return {
      ...team,
      category: categories.find(item => item.id === team.categoryId),
      judgeCount: entries.length,
      required,
      status: entries.length >= required ? "complete" : entries.length ? "in-progress" : "not-started",
      averageScore: average === null ? null : Number(average.toFixed(2)),
      judges: entries.map(entry => ({ name: entry.judge_name || "Unknown", submittedAt: entry.submitted_at }))
    };
  });
  const completed = teamRows.filter(team => team.status === "complete").length;
  return json({
    user: safeUser(user), categories, teams: teamRows,
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
  if (pathname === "/api/health" && request.method === "GET") return json({ ok: true, storage: "google-sheets" });
  if (pathname === "/api/session" && request.method === "GET") return json({ user: safeUser(await currentUser(request, env)) });
  if (pathname === "/api/login" && request.method === "POST") return login(request, env);
  if (pathname === "/api/logout" && request.method === "POST") return logout();
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

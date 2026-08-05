const test = require("node:test");
const assert = require("node:assert/strict");
const { pbkdf2Sync, randomBytes } = require("node:crypto");

test("Worker uses the same weighted rubric", async () => {
  const { computeWeightedScore, criteria } = await import("../src/config.mjs");
  assert.equal(criteria.reduce((sum, criterion) => sum + criterion.weight, 0), 100);
  assert.equal(computeWeightedScore({ impact: 10, innovation: 8, execution: 6, presentation: 4 }), 7.3);
});

test("Worker verifies PBKDF2 password hashes", async () => {
  const { verifyPassword } = await import("../src/worker.mjs");
  const password = "a-unique-password-for-testing";
  const salt = randomBytes(16);
  const iterations = 10_000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  assert.equal(await verifyPassword(password, salt.toString("base64"), hash.toString("base64"), iterations), true);
  assert.equal(await verifyPassword("wrong-password", salt.toString("base64"), hash.toString("base64"), iterations), false);
});

test("Worker reports Google Sheets storage without accessing it", async () => {
  const { handleApi } = await import("../src/worker.mjs");
  const response = await handleApi(new Request("https://example.com/api/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, storage: "google-sheets" });
});

test("Worker blocks cross-origin state-changing requests", async () => {
  const { handleApi } = await import("../src/worker.mjs");
  await assert.rejects(
    handleApi(new Request("https://example.com/api/login", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}"
    }), {}),
    error => error.status === 403
  );
});

test("Worker login, scoring, and admin results work with the Sheets bridge", { concurrency: false }, async () => {
  const { handleApi } = await import("../src/worker.mjs");
  const salt = randomBytes(16);
  const iterations = 10_000;
  const password = "local-integration-password";
  const passwordHash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64");
  const passwordSalt = salt.toString("base64");
  const env = {
    USERS_JSON: JSON.stringify([
      { id: "judge-1", name: "Test Judge", email: "judge@example.com", passwordHash, passwordSalt, passwordIterations: iterations, role: "judge", judgeType: "general", companyCategoryId: null, active: true },
      { id: "admin-1", name: "Test Admin", email: "admin@example.com", passwordHash, passwordSalt, passwordIterations: iterations, role: "admin", judgeType: null, companyCategoryId: null, active: true }
    ]),
    SESSION_SECRET: "test-session-secret-that-is-long-enough",
    SHEETS_WEB_APP_URL: "https://sheets-bridge.example/exec",
    SHEETS_SHARED_SECRET: "test-sheets-secret-that-is-long-enough",
    MIN_JUDGES: "3"
  };
  const savedFetch = global.fetch;
  const latestScores = [];
  global.fetch = async (_url, options) => {
    const envelope = JSON.parse(options.body);
    const command = JSON.parse(envelope.payload);
    if (command.action === "submit") {
      const key = `${command.data.team_id}:${command.data.judge_id}`;
      const index = latestScores.findIndex(score => `${score.team_id}:${score.judge_id}` === key);
      if (index >= 0) latestScores[index] = command.data;
      else latestScores.push(command.data);
      return Response.json({ ok: true, data: { submitted_at: command.data.submitted_at } });
    }
    return Response.json({ ok: true, data: latestScores });
  };

  try {
    const login = await handleApi(new Request("https://portal.example/api/login", {
      method: "POST",
      headers: { origin: "https://portal.example", "content-type": "application/json" },
      body: JSON.stringify({ email: "judge@example.com", password })
    }), env);
    assert.equal(login.status, 200);
    const judgeCookie = login.headers.get("set-cookie").split(";")[0];

    const score = await handleApi(new Request("https://portal.example/api/teams/t01/score", {
      method: "PUT",
      headers: { origin: "https://portal.example", cookie: judgeCookie, "content-type": "application/json" },
      body: JSON.stringify({ scores: { impact: 10, innovation: 8, execution: 6, presentation: 4 }, notes: "Strong project" })
    }), env);
    assert.equal(score.status, 200);
    assert.equal(latestScores.length, 1);
    assert.equal(latestScores[0].weighted_score, 7.3);

    const adminLogin = await handleApi(new Request("https://portal.example/api/login", {
      method: "POST",
      headers: { origin: "https://portal.example", "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@example.com", password })
    }), env);
    const adminCookie = adminLogin.headers.get("set-cookie").split(";")[0];
    const dashboard = await handleApi(new Request("https://portal.example/api/admin/dashboard", { headers: { cookie: adminCookie } }), env);
    const result = await dashboard.json();
    assert.equal(dashboard.status, 200);
    assert.equal(result.summary.submissions, 1);
    assert.equal(result.teams.find(team => team.id === "t01").averageScore, 7.3);
  } finally {
    global.fetch = savedFetch;
  }
});

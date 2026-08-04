const test = require("node:test");
const assert = require("node:assert/strict");
const { server, computeWeightedScore } = require("../server");

let baseUrl;

test.before(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test("weighted score applies the rubric percentages", () => {
  assert.equal(computeWeightedScore({ impact: 10, innovation: 8, execution: 6, presentation: 4 }), 7.3);
});

test("unauthenticated judge dashboard is protected", async () => {
  const response = await fetch(`${baseUrl}/api/judge/dashboard`);
  assert.equal(response.status, 401);
});

test("malformed and unicode passwords are rejected without crashing", async () => {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "judge@lifehack.test", password: "🔒" })
  });
  assert.equal(response.status, 401);
});

test("company judges receive every unscored company team as required and recommended", async () => {
  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "company@lifehack.test", password: "judge2026" })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const dashboard = await fetch(`${baseUrl}/api/judge/dashboard`, { headers: { cookie } });
  const payload = await dashboard.json();
  const companyTeams = payload.teams.filter(team => team.categoryId === "sustainability");
  assert.equal(companyTeams.length, 4);
  assert.ok(companyTeams.every(team => team.mandatory));
  assert.ok(companyTeams.filter(team => !team.scored).every(team => team.recommended));
  assert.ok(companyTeams.every(team => !("weightedScore" in team)));
});

test("judge credentials cannot access the admin dashboard", async () => {
  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "judge@lifehack.test", password: "judge2026" })
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${baseUrl}/api/admin/dashboard`, { headers: { cookie } });
  assert.equal(response.status, 403);
});

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

test("Worker serves a health response without database access", async () => {
  const { handleApi } = await import("../src/worker.mjs");
  const response = await handleApi(new Request("https://example.com/api/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
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

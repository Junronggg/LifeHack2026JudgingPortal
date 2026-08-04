import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputPath = path.resolve(process.argv[2] || "users.private.json");
const outputPath = path.resolve(process.argv[3] || "seed-users.private.sql");
const iterations = 210_000;
const validCategories = new Set(["sustainability", "health", "inclusion"]);

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function validate(user, index) {
  const prefix = `User ${index + 1}`;
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(user.id || "")) throw new Error(`${prefix}: id must use 2-64 letters, numbers, underscores, or hyphens.`);
  if (!String(user.name || "").trim()) throw new Error(`${prefix}: name is required.`);
  if (!/^\S+@\S+\.\S+$/.test(user.email || "")) throw new Error(`${prefix}: email is invalid.`);
  if (String(user.password || "").length < 12) throw new Error(`${prefix}: password must be at least 12 characters.`);
  if (!new Set(["judge", "admin"]).has(user.role)) throw new Error(`${prefix}: role must be judge or admin.`);
  if (user.role === "admin" && (user.judgeType || user.companyCategoryId)) throw new Error(`${prefix}: admins cannot have judge assignment fields.`);
  if (user.role === "judge" && !new Set(["general", "company"]).has(user.judgeType)) throw new Error(`${prefix}: judgeType must be general or company.`);
  if (user.judgeType === "company" && !validCategories.has(user.companyCategoryId)) throw new Error(`${prefix}: companyCategoryId is invalid.`);
  if (user.judgeType === "general" && user.companyCategoryId) throw new Error(`${prefix}: general judges cannot have companyCategoryId.`);
}

const users = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(users) || !users.length) throw new Error("The users file must contain a non-empty array.");
users.forEach(validate);
if (new Set(users.map(user => user.id)).size !== users.length) throw new Error("User ids must be unique.");
if (new Set(users.map(user => user.email.toLowerCase())).size !== users.length) throw new Error("User emails must be unique.");

const statements = [
  "-- Generated locally. Do not commit this file.",
  "BEGIN TRANSACTION;",
  ...users.map(user => {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(user.password, salt, iterations, 32, "sha256");
    return `INSERT INTO users (id, name, email, password_hash, password_salt, password_iterations, role, judge_type, company_category_id, active) VALUES (${sql(user.id)}, ${sql(user.name.trim())}, ${sql(user.email.trim().toLowerCase())}, ${sql(hash.toString("base64"))}, ${sql(salt.toString("base64"))}, ${iterations}, ${sql(user.role)}, ${sql(user.judgeType || null)}, ${sql(user.companyCategoryId || null)}, 1) ON CONFLICT(id) DO UPDATE SET name=excluded.name, email=excluded.email, password_hash=excluded.password_hash, password_salt=excluded.password_salt, password_iterations=excluded.password_iterations, role=excluded.role, judge_type=excluded.judge_type, company_category_id=excluded.company_category_id, active=1;`;
  }),
  "COMMIT;",
  ""
];

await writeFile(outputPath, statements.join("\n"), { flag: "wx" });
console.log(`Created ${outputPath} with ${users.length} password-hashed users.`);
console.log("Apply it with Wrangler, then delete it securely. Never commit this file.");

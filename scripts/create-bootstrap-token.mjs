#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const configPath = process.env.ACCOUNT_CONFIG_PATH || path.join(rootDir, "config", "account-system.env");
const token = crypto.randomBytes(32).toString("base64url");
const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
const defaultDbPath = process.env.ACCOUNT_DB_PATH || path.join(rootDir, "data", "accounts.sqlite3");

fs.mkdirSync(path.dirname(configPath), { recursive: true });

let existing = "";
try {
  existing = fs.readFileSync(configPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const values = {
  ACCOUNT_BOOTSTRAP_TOKEN_HASH: tokenHash,
  ACCOUNT_DB_PATH: defaultDbPath
};
const lines = existing
  .split(/\r?\n/)
  .filter((line) => line.trim() && !Object.keys(values).some((key) => line.startsWith(`${key}=`)));

for (const [key, value] of Object.entries(values)) {
  lines.push(`${key}=${quoteEnv(value)}`);
}

fs.writeFileSync(configPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });

console.log("Account-system bootstrap token");
console.log("");
console.log(token);
console.log("");
console.log(`Wrote bootstrap token hash and database path to ${configPath}`);
console.log("Open /login, verify this token, test/apply the database path, then create the first system administrator.");

function quoteEnv(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

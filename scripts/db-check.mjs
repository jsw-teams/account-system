#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.ACCOUNT_DB_PATH || path.join(process.cwd(), "data", "accounts.sqlite3");

if (!fs.existsSync(dbPath)) {
  console.error(`database not found: ${dbPath}`);
  process.exit(1);
}

const integrity = execFileSync("sqlite3", [dbPath, "PRAGMA integrity_check;"], { encoding: "utf8" }).trim();
const foreignKeys = execFileSync("sqlite3", [dbPath, "PRAGMA foreign_key_check;"], { encoding: "utf8" }).trim();
const tables = execFileSync("sqlite3", [dbPath, ".tables"], { encoding: "utf8" }).trim();

if (integrity !== "ok") {
  console.error(integrity);
  process.exit(1);
}

if (foreignKeys) {
  console.error(foreignKeys);
  process.exit(1);
}

console.log(`database: ${dbPath}`);
console.log("integrity_check: ok");
console.log(`tables: ${tables}`);

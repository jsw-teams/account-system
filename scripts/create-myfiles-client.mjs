#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { AccountStore } from "../src/store.mjs";

const dbPath =
  process.env.ACCOUNT_DB_PATH ||
  path.join(process.cwd(), "data", "accounts.sqlite3");
const outputPath =
  process.env.ACCOUNT_CLIENT_OUTPUT ||
  path.join(process.cwd(), "data", "myfiles-account-client.json");

const store = new AccountStore(dbPath);
await store.load();

const name = process.env.MYFILES_CLIENT_NAME || "myfiles";
const redirectUri = process.env.MYFILES_REDIRECT_URI || "https://files.js.gripe/auth/account/callback";
const scopes = (process.env.MYFILES_SCOPES || "accounts:read identities:resolve")
  .split(/[,\s]+/)
  .map((scope) => scope.trim())
  .filter(Boolean);
const replaceNames = new Set(
  (process.env.MYFILES_REPLACE_CLIENT_NAMES || "files.js.gripe,myfiles")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);

for (const client of store.listClients()) {
  if (replaceNames.has(client.name)) {
    await store.deleteClient(client.id, null);
    console.log(`[account] deleted old client: ${client.name} ${client.id}`);
  }
}

const client = await store.createClient(
  {
    name,
    redirectUris: [redirectUri],
    scopes
  },
  null
);

const result = {
  clientId: client.id,
  clientSecret: client.clientSecret,
  name,
  redirectUris: client.redirectUris,
  scopes: client.scopes,
  createdAt: client.createdAt
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify(result, null, 2));
console.log(`[account] saved to ${outputPath}`);

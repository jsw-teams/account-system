#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { AccountStore } from "../src/store.mjs";

const rootDir = path.resolve(".");
const dbPath =
  process.env.ACCOUNT_DB_PATH ||
  path.join(rootDir, "data", "accounts.sqlite3");

const store = new AccountStore(dbPath);
await store.load();

const name = "files.js.gripe";
const redirectUri = "https://files.js.gripe/auth/account/callback";
const scopes = ["accounts:read", "identities:resolve"];

// 如果已有同名 client，删除旧项。原因：旧 clientSecret 无法再次读取。
for (const client of store.listClients()) {
  if (client.name === name) {
    await store.deleteClient(client.id, null);
    console.log(`[account] deleted old client: ${client.id}`);
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

fs.writeFileSync(
  "/root/files-js-gripe-account-client.json",
  JSON.stringify(result, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify(result, null, 2));
console.log("[account] saved to /root/files-js-gripe-account-client.json");

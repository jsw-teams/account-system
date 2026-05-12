#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { AccountStore } from "../src/store.mjs";

const dbPath =
  process.env.ACCOUNT_DB_PATH ||
  path.join("/opt/account-system", "data", "accounts.sqlite3");

const store = new AccountStore(dbPath);
await store.load();

const names = new Set(["files.js.gripe", "myfiles"]);

for (const client of store.listClients()) {
  if (names.has(client.name)) {
    await store.deleteClient(client.id, null);
    console.log(`[account] deleted old client: ${client.name} ${client.id}`);
  }
}

const client = await store.createClient(
  {
    name: "myfiles",
    redirectUris: ["https://files.js.gripe/auth/account/callback"],
    scopes: ["accounts:read", "identities:resolve"]
  },
  null
);

const result = {
  clientId: client.id,
  clientSecret: client.clientSecret,
  name: "myfiles",
  redirectUris: client.redirectUris,
  scopes: client.scopes,
  createdAt: client.createdAt
};

fs.writeFileSync("/root/myfiles-account-client.json", JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify(result, null, 2));
console.log("[account] saved to /root/myfiles-account-client.json");

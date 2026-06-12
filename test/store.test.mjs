import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AccountStore } from "../src/store.mjs";

const uuidv7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("creates users, links identities, and resolves unified accounts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-system-"));
  const store = new AccountStore(path.join(dir, "accounts.sqlite3"));
  await store.load();

  const user = await store.createUser({
    email: "Alice@Example.COM",
    displayName: "Alice"
  });

  assert.equal(user.email, "alice@example.com");
  assert.match(user.id, uuidv7Pattern);

  const identity = await store.linkIdentity(user.id, {
    provider: "GitHub",
    providerSubject: "123456",
    profile: { login: "alice" }
  });

  assert.equal(identity.provider, "github");
  assert.match(identity.id, uuidv7Pattern);

  const resolved = store.resolveIdentity("github", "123456");
  assert.equal(resolved.user.id, user.id);
  assert.equal(resolved.identity.profile.login, "alice");
});

test("creates clients and verifies client secrets", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-system-"));
  const store = new AccountStore(path.join(dir, "accounts.sqlite3"));
  await store.load();

  const client = await store.createClient({
    name: "myweb",
    redirectUris: ["https://js.gripe/auth/callback"]
  });

  assert.ok(client.clientSecret);
  assert.match(client.id, uuidv7Pattern);
  assert.equal(store.verifyClient(client.id, client.clientSecret).name, "myweb");
  assert.equal(store.verifyClient(client.id, "bad-secret"), null);

  const deleted = await store.deleteClient(client.id);
  assert.equal(deleted.id, client.id);
  assert.equal(store.verifyClient(client.id, client.clientSecret), null);
});

test("self-registers members and uses authorization code flow for third-party access", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-system-"));
  const store = new AccountStore(path.join(dir, "accounts.sqlite3"));
  await store.load();

  const user = await store.registerUser({
    email: "new@example.com",
    displayName: "New User",
    password: "NewUser123!"
  });
  assert.equal(user.role, "member");
  assert.equal(user.mustChangePassword, false);
  assert.equal(user.initialPassword, undefined);

  await store.login("new@example.com", "NewUser123!");
  const client = await store.createClient({
    name: "third-party",
    redirectUris: ["https://third.example/auth/callback"],
    scopes: ["accounts:read", "identities:resolve"]
  });

  const auth = store.authorizeClientSession({
    clientId: client.id,
    redirectUri: "https://third.example/auth/callback",
    scope: "accounts:read identities:resolve",
    state: "state-123",
  }, user);
  const callback = new URL(auth.callbackUrl);
  assert.equal(callback.origin + callback.pathname, "https://third.example/auth/callback");
  assert.equal(callback.searchParams.get("state"), "state-123");
  assert.ok(callback.searchParams.get("code"));
  assert.equal(callback.searchParams.has("account_session"), false);
  assert.equal(callback.searchParams.has("access_token"), false);
  assert.equal(callback.searchParams.has("refresh_token"), false);
  assert.equal(callback.searchParams.has("user_id"), false);

  const exchanged = store.exchangeAuthorizationCode({
    clientId: client.id,
    clientSecret: client.clientSecret,
    code: callback.searchParams.get("code"),
    redirectUri: "https://third.example/auth/callback"
  });
  assert.equal(exchanged.tokenType, "Bearer");
  assert.equal(exchanged.user.id, user.id);
  assert.equal(store.getSession(exchanged.accessToken).user.id, user.id);

  assert.throws(
    () => store.exchangeAuthorizationCode({
      clientId: client.id,
      clientSecret: client.clientSecret,
      code: callback.searchParams.get("code"),
      redirectUri: "https://third.example/auth/callback"
    }),
    (error) => error.code === "invalid_grant"
  );

  assert.throws(
    () => store.authorizeClientSession({
      clientId: client.id,
      redirectUri: "https://evil.example/callback"
    }, user),
    (error) => error.code === "invalid_redirect_uri"
  );
});

test("rejects authorization scopes outside the client grant", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-system-"));
  const store = new AccountStore(path.join(dir, "accounts.sqlite3"));
  await store.load();

  const user = await store.registerUser({
    email: "scope@example.com",
    password: "ScopePass123!"
  });
  const client = await store.createClient({
    name: "limited",
    redirectUris: ["https://third.example/auth/callback"],
    scopes: ["accounts:read"]
  });

  assert.throws(
    () => store.authorizeClientSession({
      clientId: client.id,
      redirectUri: "https://third.example/auth/callback",
      scope: "audit:read"
    }, user),
    (error) => error.code === "invalid_scope"
  );
});

test("sets up the first administrator and creates sessions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-system-"));
  const store = new AccountStore(path.join(dir, "accounts.sqlite3"));
  await store.load();

  assert.equal(store.isInitialized(), false);
  const admin = await store.setupFirstAdmin({
    email: "admin@account.local",
    displayName: "Root",
    password: "ChangeMe123!"
  });
  assert.equal(admin.role, "system_admin");
  assert.equal(admin.capabilities.users, true);
  assert.equal(admin.capabilities.clients, true);
  assert.equal(store.isInitialized(), true);

  const login = await store.login("admin@account.local", "ChangeMe123!");
  assert.equal(login.user.role, "system_admin");
  assert.equal(login.user.mustChangePassword, false);

  const session = store.getSession(login.token);
  assert.equal(session.user.email, "admin@account.local");
});

test("normalizes user types and exposes role capabilities", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-system-"));
  const store = new AccountStore(path.join(dir, "accounts.sqlite3"));
  await store.load();

  const operator = await store.createUser({
    email: "ops@example.com",
    role: "operator"
  });
  const auditor = await store.createUser({
    email: "audit@example.com",
    role: "auditor"
  });
  const member = await store.createUser({
    email: "member@example.com"
  });

  assert.equal(operator.capabilities.users, true);
  assert.equal(operator.capabilities.clients, false);
  assert.equal(auditor.capabilities.audit, true);
  assert.equal(auditor.capabilities.users, false);
  assert.equal(member.role, "member");
  assert.equal(member.capabilities.settings, true);
});

test("updates own profile and deactivates own account", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-system-"));
  const store = new AccountStore(path.join(dir, "accounts.sqlite3"));
  await store.load();

  const user = await store.createUser({
    email: "self@example.com",
    password: "SelfPass123!",
    mustChangePassword: false
  });

  const updated = await store.updateOwnProfile(user.id, {
    displayName: "Self Renamed"
  });
  assert.equal(updated.displayName, "Self Renamed");

  const login = await store.login("self@example.com", "SelfPass123!");
  assert.equal(store.getSession(login.token).user.id, user.id);

  const deactivated = await store.deactivateOwnAccount(user.id);
  assert.equal(deactivated.status, "disabled");
  assert.equal(store.getSession(login.token), null);
  await assert.rejects(() => store.login("self@example.com", "SelfPass123!"), /账户已停用/);
});

test("disables users with a reason and deletes users for re-registration", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-system-"));
  const store = new AccountStore(path.join(dir, "accounts.sqlite3"));
  await store.load();

  const user = await store.createUser({
    email: "blocked@example.com",
    password: "BlockPass123!",
    mustChangePassword: false
  });

  const disabled = await store.updateUser(user.id, {
    displayName: user.displayName,
    role: user.role,
    status: "disabled",
    disabledReason: "测试封禁"
  }, "018ff5c8-9a08-7a1d-8b9d-2ab45e22a101");
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.disabledReason, "测试封禁");

  await assert.rejects(
    () => store.login("blocked@example.com", "BlockPass123!"),
    (error) => error.code === "account_disabled" && error.detail.supportEmail === "helper@js.gripe"
  );

  await assert.rejects(
    () => store.createUser({ email: "blocked@example.com" }),
    /email already exists/
  );

  const deleted = await store.deleteUser(user.id, "018ff5c8-9a08-7a1d-8b9d-2ab45e22a101");
  assert.equal(deleted.email, "blocked@example.com");
  const recreated = await store.createUser({
    email: "blocked@example.com",
    password: "BlockPass456!"
  });
  assert.notEqual(recreated.id, user.id);
});

test("protects system administrators from user-management destructive actions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-system-"));
  const store = new AccountStore(path.join(dir, "accounts.sqlite3"));
  await store.load();

  const admin = await store.setupFirstAdmin({
    email: "root@example.com",
    displayName: "Root",
    password: "RootPass123!"
  });

  await assert.rejects(
    () => store.updateUser(admin.id, {
      displayName: admin.displayName,
      role: "member",
      status: "active"
    }, "018ff5c8-9a08-7a1d-8b9d-2ab45e22a101"),
    (error) => error.code === "protected_system_admin"
  );

  await assert.rejects(
    () => store.updateUser(admin.id, {
      displayName: admin.displayName,
      role: "system_admin",
      status: "disabled",
      disabledReason: "unsafe"
    }, "018ff5c8-9a08-7a1d-8b9d-2ab45e22a101"),
    (error) => error.code === "protected_system_admin"
  );

  await assert.rejects(
    () => store.deleteUser(admin.id, "018ff5c8-9a08-7a1d-8b9d-2ab45e22a101"),
    (error) => error.code === "protected_system_admin"
  );
});

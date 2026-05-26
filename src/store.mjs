import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;
const roles = new Set(["system_admin", "operator", "auditor", "member"]);
const supportEmail = "helper@js.gripe";

export class AccountStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        role TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_subject TEXT NOT NULL,
        profile_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, provider_subject)
      );

      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        redirect_uris_json TEXT NOT NULL DEFAULT '[]',
        scopes_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);
  }

  isInitialized() {
    const count = this.queryOne("SELECT COUNT(*) AS count FROM users").count;
    return Number(count) > 0;
  }

  async setupFirstAdmin(input) {
    if (this.isInitialized()) {
      throw httpError(409, "account system is already initialized");
    }
    const email = normalizeEmail(input.email);
    if (!email) {
      throw httpError(400, "email is required");
    }
    const password = String(input.password || "");
    validatePassword(password);
    const now = new Date().toISOString();
    const passwordRecord = hashPassword(password);
    const userId = `usr_${crypto.randomUUID()}`;
    this.exec(`
      INSERT INTO users (
        id, email, password_hash, password_salt, display_name, status, role,
        must_change_password, metadata_json, created_at, updated_at
      ) VALUES (
        ${sql(userId)}, ${sql(email)}, ${sql(passwordRecord.hash)}, ${sql(passwordRecord.salt)},
        ${sql(String(input.displayName || "Administrator").trim() || "Administrator")},
        'active', 'system_admin', 0, '{}', ${sql(now)}, ${sql(now)}
      );
    `);
    this.audit(userId, "system.setup", "user", userId, { email });
    return this.getUser(userId);
  }

  listUsers() {
    return this.query("SELECT * FROM users ORDER BY created_at DESC").map(publicUser);
  }

  getUser(userId) {
    const user = this.queryOne(`SELECT * FROM users WHERE id = ${sql(userId)}`);
    return user ? withIdentities(publicUser(user), this.listIdentitiesForUser(user.id)) : null;
  }

  async createUser(input, actorUserId = null) {
    const email = normalizeEmail(input.email);
    if (!email) {
      throw httpError(400, "email is required");
    }

    const password = String(input.password || generatePassword());
    const passwordRecord = hashPassword(password);
    const now = new Date().toISOString();
    const user = {
      id: `usr_${crypto.randomUUID()}`,
      email,
      display_name: String(input.displayName || email.split("@")[0]).trim(),
      status: input.status === "disabled" ? "disabled" : "active",
      role: normalizeRole(input.role),
      must_change_password: input.mustChangePassword === false ? 0 : 1,
      metadata_json: JSON.stringify(isPlainObject(input.metadata) ? input.metadata : {}),
      created_at: now,
      updated_at: now
    };

    try {
      this.exec(`
        INSERT INTO users (
          id, email, password_hash, password_salt, display_name, status, role,
          must_change_password, metadata_json, created_at, updated_at
        ) VALUES (
          ${sql(user.id)}, ${sql(user.email)}, ${sql(passwordRecord.hash)}, ${sql(passwordRecord.salt)},
          ${sql(user.display_name)}, ${sql(user.status)}, ${sql(user.role)}, ${user.must_change_password},
          ${sql(user.metadata_json)}, ${sql(now)}, ${sql(now)}
        );
      `);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        throw httpError(409, "email already exists", "email_exists");
      }
      throw error;
    }

    this.audit(actorUserId, "user.create", "user", user.id, { email });
    return {
      ...publicUser(user),
      initialPassword: password
    };
  }

  async registerUser(input) {
    const email = normalizeEmail(input.email);
    if (!email) {
      throw httpError(400, "email is required");
    }

    const password = String(input.password || "");
    validatePassword(password);
    const user = await this.createUser({
      email,
      password,
      displayName: String(input.displayName || email.split("@")[0]).trim(),
      role: "member",
      status: "active",
      mustChangePassword: false,
      metadata: {
        registeredBy: "self"
      }
    }, null);
    this.audit(user.id, "auth.register", "user", user.id, { email });
    const { initialPassword, ...publicRegisteredUser } = user;
    return publicRegisteredUser;
  }

  async updateUser(userId, input, actorUserId = null) {
    const user = this.queryOne(`SELECT * FROM users WHERE id = ${sql(userId)}`);
    if (!user) {
      throw httpError(404, "user not found");
    }
    const currentRole = normalizeRole(user.role);

    const metadata = input.metadata === undefined ? parseJson(user.metadata_json, {}) : (isPlainObject(input.metadata) ? input.metadata : {});
    const nextStatus = input.status === "disabled" ? "disabled" : "active";
    const nextRole = normalizeRole(input.role);
    if (currentRole === "system_admin" && nextStatus === "disabled") {
      throw httpError(400, "system administrator accounts cannot be disabled from user management", "protected_system_admin");
    }
    if (currentRole === "system_admin" && nextRole !== "system_admin") {
      throw httpError(400, "system administrator accounts cannot be downgraded", "protected_system_admin");
    }
    if (nextStatus === "disabled") {
      const disabledReason = String(input.disabledReason || metadata.disabledReason || "").trim();
      if (!disabledReason) {
        throw httpError(400, "disabledReason is required", "disabled_reason_required");
      }
      metadata.disabledReason = disabledReason;
      metadata.disabledAt = new Date().toISOString();
      metadata.disabledBy = actorUserId;
      delete metadata.selfDeactivated;
    } else {
      delete metadata.disabledReason;
      delete metadata.disabledAt;
      delete metadata.disabledBy;
      delete metadata.selfDeactivated;
    }

    const next = {
      display_name: input.displayName === undefined ? user.display_name : String(input.displayName || "").trim(),
      status: nextStatus,
      role: nextRole,
      metadata_json: JSON.stringify(metadata),
      updated_at: new Date().toISOString()
    };

    this.exec(`
      UPDATE users
      SET display_name = ${sql(next.display_name || user.email)},
          status = ${sql(next.status)},
          role = ${sql(next.role)},
          metadata_json = ${sql(next.metadata_json)},
          updated_at = ${sql(next.updated_at)}
      WHERE id = ${sql(userId)};
    `);
    this.audit(actorUserId, "user.update", "user", userId, {});
    return this.getUser(userId);
  }

  async deleteUser(userId, actorUserId = null) {
    const user = this.queryOne(`SELECT * FROM users WHERE id = ${sql(userId)}`);
    if (!user) {
      throw httpError(404, "user not found", "user_not_found");
    }
    if (actorUserId && actorUserId === userId) {
      throw httpError(400, "use self deactivation instead of deleting your own account", "cannot_delete_self");
    }
    if (normalizeRole(user.role) === "system_admin") {
      throw httpError(400, "system administrator accounts cannot be deleted", "protected_system_admin");
    }

    this.exec(`DELETE FROM users WHERE id = ${sql(userId)};`);
    this.audit(actorUserId, "user.delete", "user", userId, { email: user.email });
    return publicUser(user);
  }

  async resetPassword(userId, input, actorUserId = null) {
    const user = this.queryOne(`SELECT * FROM users WHERE id = ${sql(userId)}`);
    if (!user) {
      throw httpError(404, "user not found");
    }

    const password = String(input.password || generatePassword());
    const passwordRecord = hashPassword(password);
    const now = new Date().toISOString();
    this.exec(`
      UPDATE users
      SET password_hash = ${sql(passwordRecord.hash)},
          password_salt = ${sql(passwordRecord.salt)},
          must_change_password = ${input.mustChangePassword === false ? 0 : 1},
          updated_at = ${sql(now)}
      WHERE id = ${sql(userId)};
      DELETE FROM sessions WHERE user_id = ${sql(userId)};
    `);
    this.audit(actorUserId, "user.password_reset", "user", userId, {});
    return { user: this.getUser(userId), password };
  }

  async updateOwnProfile(userId, input) {
    const user = this.queryOne(`SELECT * FROM users WHERE id = ${sql(userId)}`);
    if (!user) {
      throw httpError(404, "user not found");
    }

    const displayName = String(input.displayName || "").trim();
    if (!displayName) {
      throw httpError(400, "displayName is required");
    }

    const now = new Date().toISOString();
    this.exec(`
      UPDATE users
      SET display_name = ${sql(displayName)},
          updated_at = ${sql(now)}
      WHERE id = ${sql(userId)};
    `);
    this.audit(userId, "user.profile_update", "user", userId, {});
    return this.getUser(userId);
  }

  async changeOwnPassword(userId, input) {
    const user = this.queryOne(`SELECT * FROM users WHERE id = ${sql(userId)}`);
    if (!user) {
      throw httpError(404, "user not found");
    }
    if (!verifyPassword(String(input.currentPassword || ""), user.password_salt, user.password_hash)) {
      throw httpError(401, "current password is incorrect");
    }
    const password = String(input.newPassword || "");
    validatePassword(password);
    const passwordRecord = hashPassword(password);
    const now = new Date().toISOString();
    this.exec(`
      UPDATE users
      SET password_hash = ${sql(passwordRecord.hash)},
          password_salt = ${sql(passwordRecord.salt)},
          must_change_password = 0,
          updated_at = ${sql(now)}
      WHERE id = ${sql(userId)};
    `);
    this.audit(userId, "user.password_change", "user", userId, {});
    return this.getUser(userId);
  }

  async deactivateOwnAccount(userId) {
    const user = this.queryOne(`SELECT * FROM users WHERE id = ${sql(userId)}`);
    if (!user) {
      throw httpError(404, "user not found");
    }

    const now = new Date().toISOString();
    const metadata = parseJson(user.metadata_json, {});
    metadata.disabledReason = `账户已由用户自主注销。如需恢复，请联系 ${supportEmail} 支持团队。`;
    metadata.disabledAt = now;
    metadata.selfDeactivated = true;
    this.exec(`
      UPDATE users
      SET status = 'disabled',
          metadata_json = ${sql(JSON.stringify(metadata))},
          updated_at = ${sql(now)}
      WHERE id = ${sql(userId)};
      DELETE FROM sessions WHERE user_id = ${sql(userId)};
    `);
    this.audit(userId, "user.deactivate_self", "user", userId, {});
    return publicUser({ ...user, status: "disabled", metadata_json: JSON.stringify(metadata), updated_at: now });
  }

  async linkIdentity(userId, input, actorUserId = null) {
    const user = this.queryOne(`SELECT * FROM users WHERE id = ${sql(userId)}`);
    if (!user) {
      throw httpError(404, "user not found");
    }

    const provider = normalizeId(input.provider);
    const providerSubject = normalizeSubject(input.providerSubject);
    if (!provider || !providerSubject) {
      throw httpError(400, "provider and providerSubject are required");
    }

    const exists = this.queryOne(`
      SELECT * FROM identities
      WHERE provider = ${sql(provider)} AND provider_subject = ${sql(providerSubject)}
    `);
    if (exists && exists.user_id !== userId) {
      throw httpError(409, "identity already linked to another user");
    }
    if (exists) {
      return publicIdentity(exists);
    }

    const now = new Date().toISOString();
    const identity = {
      id: `idn_${crypto.randomUUID()}`,
      user_id: userId,
      provider,
      provider_subject: providerSubject,
      profile_json: JSON.stringify(isPlainObject(input.profile) ? input.profile : {}),
      created_at: now,
      updated_at: now
    };

    this.exec(`
      INSERT INTO identities (
        id, user_id, provider, provider_subject, profile_json, created_at, updated_at
      ) VALUES (
        ${sql(identity.id)}, ${sql(userId)}, ${sql(provider)}, ${sql(providerSubject)},
        ${sql(identity.profile_json)}, ${sql(now)}, ${sql(now)}
      );
      UPDATE users SET updated_at = ${sql(now)} WHERE id = ${sql(userId)};
    `);
    this.audit(actorUserId, "identity.link", "identity", identity.id, { provider, userId });
    return publicIdentity(identity);
  }

  resolveIdentity(provider, providerSubject) {
    const identity = this.queryOne(`
      SELECT * FROM identities
      WHERE provider = ${sql(normalizeId(provider))} AND provider_subject = ${sql(normalizeSubject(providerSubject))}
    `);
    if (!identity) {
      return null;
    }

    const user = this.queryOne(`SELECT * FROM users WHERE id = ${sql(identity.user_id)}`);
    if (!user) {
      return null;
    }

    return {
      identity: publicIdentity(identity),
      user: publicUser(user)
    };
  }

  async unlinkIdentity(identityId, actorUserId = null) {
    const identity = this.queryOne(`SELECT * FROM identities WHERE id = ${sql(identityId)}`);
    if (!identity) {
      throw httpError(404, "identity not found");
    }

    const now = new Date().toISOString();
    this.exec(`
      DELETE FROM identities WHERE id = ${sql(identityId)};
      UPDATE users SET updated_at = ${sql(now)} WHERE id = ${sql(identity.user_id)};
    `);
    this.audit(actorUserId, "identity.unlink", "identity", identityId, {});
    return publicIdentity(identity);
  }

  listClients() {
    return this.query("SELECT * FROM clients ORDER BY created_at DESC").map(publicClient);
  }

  async deleteClient(clientId, actorUserId = null) {
    const key = String(clientId || "").trim();
    if (!key) {
      throw httpError(400, "api credential id or name is required", "api_key_required");
    }

    let client = this.queryOne(`SELECT * FROM clients WHERE id = ${sql(key)}`);

    if (!client) {
      const matches = this.query(`
        SELECT * FROM clients
        WHERE name = ${sql(key)}
        ORDER BY created_at DESC
      `);

      if (matches.length > 1) {
        throw httpError(409, "api credential name is ambiguous", "api_name_ambiguous", {
          name: key,
          count: matches.length
        });
      }

      client = matches[0] || null;
    }

    if (!client) {
      throw httpError(404, "api credential not found", "api_not_found", {
        idOrName: key
      });
    }

    this.exec(`DELETE FROM clients WHERE id = ${sql(client.id)};`);
    this.audit(actorUserId, "api.delete", "api", client.id, {
      name: client.name,
      requested: key
    });

    return publicClient(client);
  }

  async createClient(input, actorUserId = null) {
    const name = String(input.name || "").trim();
    if (!name) {
      throw httpError(400, "name is required");
    }

    const secret = crypto.randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    const client = {
      id: `cli_${crypto.randomUUID()}`,
      name,
      secret_hash: hashSecret(secret),
      redirect_uris_json: JSON.stringify(Array.isArray(input.redirectUris) ? input.redirectUris.map(String) : []),
      scopes_json: JSON.stringify(Array.isArray(input.scopes) ? input.scopes.map(String) : ["accounts:read"]),
      status: "active",
      created_at: now,
      updated_at: now
    };

    this.exec(`
      INSERT INTO clients (
        id, name, secret_hash, redirect_uris_json, scopes_json, status, created_at, updated_at
      ) VALUES (
        ${sql(client.id)}, ${sql(client.name)}, ${sql(client.secret_hash)},
        ${sql(client.redirect_uris_json)}, ${sql(client.scopes_json)}, ${sql(client.status)},
        ${sql(now)}, ${sql(now)}
      );
    `);
    this.audit(actorUserId, "api.create", "api", client.id, { name });
    return {
      ...publicClient(client),
      clientSecret: secret
    };
  }

  verifyClient(clientId, clientSecret) {
    const client = this.queryOne(`
      SELECT * FROM clients WHERE id = ${sql(clientId)} AND status = 'active'
    `);
    if (!client || client.secret_hash !== hashSecret(String(clientSecret || ""))) {
      return null;
    }
    return publicClient(client);
  }

  verifyClientCredentials(input = {}) {
    const clientId = input.clientId || input.client_id || input.id;
    const clientSecret = input.clientSecret || input.client_secret || input.apiKey || input.api_key;
    return this.verifyClient(clientId, clientSecret);
  }

  getClient(clientId) {
    const client = this.queryOne(`
      SELECT * FROM clients WHERE id = ${sql(clientId)} AND status = 'active'
    `);
    return client ? publicClient(client) : null;
  }

  authorizeClientSession(input, sessionToken, user) {
    const client = this.getClient(input.clientId || input.client_id);
    if (!client) {
      throw httpError(404, "api client not found", "client_not_found");
    }

    const redirectUri = String(input.redirectUri || input.redirect_uri || "").trim();
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      throw httpError(400, "redirect_uri is not registered for this client", "invalid_redirect_uri");
    }
    const parsedRedirectUri = parseRedirectUri(redirectUri);
    if (!isAllowedRedirectProtocol(parsedRedirectUri)) {
      throw httpError(400, "redirect_uri must use HTTPS", "invalid_redirect_uri");
    }

    const requestedScopes = normalizeScopes(input.scope || input.scopes);
    const deniedScope = requestedScopes.find((scope) => !client.scopes.includes(scope));
    if (deniedScope) {
      throw httpError(400, `scope is not allowed: ${deniedScope}`, "invalid_scope", { scope: deniedScope });
    }

    const callbackUrl = parsedRedirectUri;
    if (input.state) {
      callbackUrl.searchParams.set("state", String(input.state));
    }
    callbackUrl.searchParams.set("account_session", sessionToken);
    callbackUrl.searchParams.set("token_type", "Bearer");
    callbackUrl.searchParams.set("expires_at", String(input.expiresAt || ""));
    callbackUrl.searchParams.set("user_id", user.id);
    callbackUrl.searchParams.set("scope", requestedScopes.join(" "));

    this.audit(user.id, "auth.authorize", "api", client.id, {
      redirectUri,
      scopes: requestedScopes
    });

    return {
      callbackUrl: callbackUrl.toString(),
      client,
      user,
      tokenType: "Bearer",
      accountSession: sessionToken,
      expiresAt: String(input.expiresAt || ""),
      scopes: requestedScopes
    };
  }

  async login(email, password) {
    const user = this.queryOne(`SELECT * FROM users WHERE email = ${sql(normalizeEmail(email))}`);
    if (!user) {
      throw httpError(401, "bad email or password", "bad_credentials");
    }
    if (user.status !== "active") {
      throw accountDisabledError(user);
    }
    if (!verifyPassword(String(password || ""), user.password_salt, user.password_hash)) {
      throw httpError(401, "bad email or password", "bad_credentials");
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const now = new Date();
    const expires = new Date(now.getTime() + sessionTtlMs);
    this.exec(`
      INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
      VALUES (${sql(hashSecret(token))}, ${sql(user.id)}, ${sql(now.toISOString())}, ${sql(now.toISOString())}, ${sql(expires.toISOString())});
    `);
    this.audit(user.id, "auth.login", "session", user.id, {});
    return {
      token,
      expiresAt: expires.toISOString(),
      user: publicUser(user)
    };
  }

  getSession(token) {
    if (!token) {
      return null;
    }
    const now = new Date().toISOString();
    const session = this.queryOne(`
      SELECT sessions.*, users.email, users.display_name, users.status, users.role,
             users.must_change_password, users.metadata_json, users.created_at AS user_created_at,
             users.updated_at AS user_updated_at
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ${sql(hashSecret(token))}
        AND sessions.expires_at > ${sql(now)}
        AND users.status = 'active'
    `);
    if (!session) {
      return null;
    }
    this.exec(`
      UPDATE sessions SET last_seen_at = ${sql(now)}
      WHERE token_hash = ${sql(hashSecret(token))};
    `);
    return {
      tokenHash: session.token_hash,
      expiresAt: session.expires_at,
      user: publicUser({
        id: session.user_id,
        email: session.email,
        display_name: session.display_name,
        status: session.status,
        role: session.role,
        must_change_password: session.must_change_password,
        metadata_json: session.metadata_json,
        created_at: session.user_created_at,
        updated_at: session.user_updated_at
      })
    };
  }

  async logout(token) {
    if (!token) {
      return;
    }
    this.exec(`DELETE FROM sessions WHERE token_hash = ${sql(hashSecret(token))};`);
  }

  listAuditLogs(limit = 100) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.query(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ${safeLimit}`).map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      detail: parseJson(row.detail_json, {}),
      createdAt: row.created_at
    }));
  }

  listIdentitiesForUser(userId) {
    return this.query(`SELECT * FROM identities WHERE user_id = ${sql(userId)} ORDER BY created_at DESC`).map(publicIdentity);
  }

  audit(actorUserId, action, targetType, targetId, detail) {
    const now = new Date().toISOString();
    this.exec(`
      INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, detail_json, created_at)
      VALUES (
        ${sql(`aud_${crypto.randomUUID()}`)}, ${sql(actorUserId)}, ${sql(action)},
        ${sql(targetType)}, ${sql(targetId)}, ${sql(JSON.stringify(detail || {}))}, ${sql(now)}
      );
    `);
  }

  queryOne(statement) {
    return this.query(statement)[0] || null;
  }

  query(statement) {
    const output = execFileSync("sqlite3", ["-json", this.filePath, statement], { encoding: "utf8" }).trim();
    return output ? JSON.parse(output) : [];
  }

  exec(statement) {
    execFileSync("sqlite3", [this.filePath, statement], { encoding: "utf8" });
  }
}

function publicUser(user) {
  const role = normalizeRole(user.role);
  const metadata = parseJson(user.metadata_json, {});
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    role,
    userType: role,
    capabilities: capabilitiesForRole(role),
    mustChangePassword: Boolean(Number(user.must_change_password)),
    disabledReason: metadata.disabledReason || "",
    metadata,
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
}

function publicIdentity(identity) {
  return {
    id: identity.id,
    userId: identity.user_id,
    provider: identity.provider,
    providerSubject: identity.provider_subject,
    profile: parseJson(identity.profile_json, {}),
    createdAt: identity.created_at,
    updatedAt: identity.updated_at
  };
}

function publicClient(client) {
  return {
    id: client.id,
    name: client.name,
    redirectUris: parseJson(client.redirect_uris_json, []),
    scopes: parseJson(client.scopes_json, []),
    status: client.status,
    createdAt: client.created_at,
    updatedAt: client.updated_at
  };
}

function normalizeScopes(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\s]+/);
  return [...new Set(values.map((scope) => String(scope || "").trim()).filter(Boolean))];
}

function parseRedirectUri(value) {
  try {
    return new URL(value);
  } catch {
    throw httpError(400, "redirect_uri is invalid", "invalid_redirect_uri");
  }
}

function isAllowedRedirectProtocol(url) {
  return url.protocol === "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function withIdentities(user, identities) {
  return {
    ...user,
    identities
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSubject(value) {
  return String(value || "").trim();
}

function normalizeRole(value) {
  const role = String(value || "").trim();
  if (role === "admin") return "system_admin";
  if (role === "user") return "member";
  return roles.has(role) ? role : "member";
}

function capabilitiesForRole(role) {
  return {
    users: role === "system_admin" || role === "operator",
    clients: role === "system_admin",
    audit: role === "system_admin" || role === "auditor",
    settings: true
  };
}

function hashSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  validatePassword(password);
  return {
    salt,
    hash: crypto.pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("base64url")
  };
}

function verifyPassword(password, salt, expectedHash) {
  const actualHash = crypto.pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("base64url");
  const actual = Buffer.from(actualHash);
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validatePassword(password) {
  if (String(password || "").length < 10) {
    throw httpError(400, "password must be at least 10 characters");
  }
}

function generatePassword() {
  return `${crypto.randomBytes(12).toString("base64url")}A1!`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function sql(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function accountDisabledError(user) {
  const metadata = parseJson(user.metadata_json, {});
  const reason = String(metadata.disabledReason || "").trim();
  const message = reason
    ? `账户已停用：${reason}`
    : `账户已停用。如需恢复，请联系 ${supportEmail} 支持团队。`;
  return httpError(403, message, "account_disabled", {
    disabledReason: reason,
    supportEmail,
    selfDeactivated: Boolean(metadata.selfDeactivated)
  });
}

export function httpError(statusCode, message, code = "request_failed", detail = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.detail = detail;
  return error;
}

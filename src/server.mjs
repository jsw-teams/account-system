#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccountStore } from "./store.mjs";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataPath = process.env.ACCOUNT_DB_PATH || path.join(rootDir, "data", "accounts.sqlite3");
const publicDir = process.env.ACCOUNT_PUBLIC_DIR || path.join(rootDir, "public");
const host = process.env.ACCOUNT_HOST || "127.0.0.1";
const port = Number(process.env.ACCOUNT_PORT || 9100);
const basePath = normalizeBasePath(process.env.ACCOUNT_BASE_PATH || "/api/v1/myaccount");
const allowedOrigin = process.env.ACCOUNT_ALLOWED_ORIGIN || "https://account.js.gripe";

const store = new AccountStore(dataPath);
await store.load();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (handleCors(req, res)) {
      return;
    }

    if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === `${basePath}/healthz`)) {
      sendJson(req, res, 200, { ok: true, service: "account-system", initialized: store.isInitialized() });
      return;
    }

    if (url.pathname === "/" || !url.pathname.startsWith(basePath)) {
      await serveStatic(req, res, url);
      return;
    }

    const routePath = url.pathname.slice(basePath.length) || "/";

    if (req.method === "GET" && routePath === "/setup/status") {
      sendJson(req, res, 200, { initialized: store.isInitialized() });
      return;
    }

    if (req.method === "POST" && routePath === "/setup/init") {
      sendJson(req, res, 201, { user: await store.setupFirstAdmin(await readJson(req)) });
      return;
    }

    if (req.method === "POST" && routePath === "/auth/login") {
      if (!store.isInitialized()) {
        sendJson(req, res, 409, { error: "account system is not initialized" });
        return;
      }
      const body = await readJson(req);
      sendJson(req, res, 200, await store.login(body.email, body.password));
      return;
    }

    if (req.method === "POST" && routePath === "/auth/register") {
      if (!store.isInitialized()) {
        sendJson(req, res, 409, { error: "account system is not initialized" });
        return;
      }
      const body = await readJson(req);
      const user = await store.registerUser(body);
      const login = await store.login(user.email, body.password);
      sendJson(req, res, 201, login);
      return;
    }

    const session = requireSession(req);

    if (req.method === "POST" && routePath === "/auth/logout") {
      await store.logout(getBearerToken(req));
      sendJson(req, res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && routePath === "/auth/authorize") {
      const token = getBearerToken(req);
      sendJson(req, res, 200, store.authorizeClientSession({
        ...(await readJson(req)),
        expiresAt: session.expiresAt
      }, token, session.user));
      return;
    }

    if (req.method === "GET" && routePath === "/me") {
      sendJson(req, res, 200, { user: session.user, expiresAt: session.expiresAt });
      return;
    }

    if (req.method === "PATCH" && routePath === "/me") {
      sendJson(req, res, 200, { user: await store.updateOwnProfile(session.user.id, await readJson(req)) });
      return;
    }

    if (req.method === "POST" && routePath === "/me/password") {
      sendJson(req, res, 200, { user: await store.changeOwnPassword(session.user.id, await readJson(req)) });
      return;
    }

    if (req.method === "POST" && routePath === "/me/deactivate") {
      sendJson(req, res, 200, { user: await store.deactivateOwnAccount(session.user.id) });
      return;
    }

    if (req.method === "GET" && routePath === "/users") {
      requireCapability(session, "users");
      sendJson(req, res, 200, { users: store.listUsers() });
      return;
    }

    if (req.method === "POST" && routePath === "/users") {
      requireCapability(session, "users");
      sendJson(req, res, 201, { user: await store.createUser(await readJson(req), session.user.id) });
      return;
    }

    const userMatch = routePath.match(/^\/users\/([^/]+)$/);
    if (req.method === "GET" && userMatch) {
      requireCapability(session, "users");
      const user = store.getUser(userMatch[1]);
      sendJson(req, res, user ? 200 : 404, user ? { user } : { error: "user not found" });
      return;
    }

    if (req.method === "PATCH" && userMatch) {
      requireCapability(session, "users");
      sendJson(req, res, 200, { user: await store.updateUser(userMatch[1], await readJson(req), session.user.id) });
      return;
    }

    if (req.method === "DELETE" && userMatch) {
      requireCapability(session, "users");
      sendJson(req, res, 200, { user: await store.deleteUser(userMatch[1], session.user.id) });
      return;
    }

    const passwordMatch = routePath.match(/^\/users\/([^/]+)\/password$/);
    if (req.method === "POST" && passwordMatch) {
      requireCapability(session, "users");
      sendJson(req, res, 200, await store.resetPassword(passwordMatch[1], await readJson(req), session.user.id));
      return;
    }

    const linkMatch = routePath.match(/^\/users\/([^/]+)\/identities$/);
    if (req.method === "POST" && linkMatch) {
      requireCapability(session, "users");
      const identity = await store.linkIdentity(linkMatch[1], await readJson(req), session.user.id);
      sendJson(req, res, 201, { identity });
      return;
    }

    if (req.method === "DELETE" && routePath.startsWith("/identities/")) {
      requireCapability(session, "users");
      const identityId = routePath.split("/").at(-1);
      sendJson(req, res, 200, { identity: await store.unlinkIdentity(identityId, session.user.id) });
      return;
    }

    if (req.method === "GET" && routePath === "/identity/resolve") {
      const result = store.resolveIdentity(url.searchParams.get("provider"), url.searchParams.get("providerSubject"));
      if (result?.user?.status && result.user.status !== "active") {
        sendJson(req, res, 403, {
          error: result.user.disabledReason || "account is disabled",
          code: "account_disabled",
          detail: {
            userId: result.user.id,
            disabledReason: result.user.disabledReason || "",
            supportEmail: "helper@js.gripe"
          }
        });
        return;
      }
      sendJson(req, res, result ? 200 : 404, result || { error: "identity not found", code: "identity_not_found", detail: {} });
      return;
    }

    if (req.method === "GET" && (routePath === "/clients" || routePath === "/apis")) {
      requireCapability(session, "clients");
      const apis = store.listClients();
      sendJson(req, res, 200, { apis, clients: apis });
      return;
    }

    if (req.method === "POST" && (routePath === "/clients" || routePath === "/apis")) {
      requireCapability(session, "clients");
      const api = await store.createClient(await readJson(req), session.user.id);
      sendJson(req, res, 201, { api, client: api });
      return;
    }

    const apiMatch = routePath.match(/^\/(?:clients|apis)\/([^/]+)$/);
    if (req.method === "DELETE" && apiMatch) {
      requireCapability(session, "clients");
      const api = await store.deleteClient(apiMatch[1], session.user.id);
      sendJson(req, res, 200, { api, client: api });
      return;
    }

    if (req.method === "POST" && (routePath === "/clients/verify" || routePath === "/apis/verify")) {
      const body = await readJson(req);
      const client = store.verifyClient(body.clientId, body.clientSecret);
      sendJson(req, res, client ? 200 : 401, client ? { api: client, client } : { error: "bad api credentials", code: "bad_api_credentials", detail: {} });
      return;
    }

    if (req.method === "GET" && routePath === "/audit-logs") {
      requireCapability(session, "audit");
      sendJson(req, res, 200, { logs: store.listAuditLogs(url.searchParams.get("limit")) });
      return;
    }

    sendJson(req, res, 404, { error: "not found" });
  } catch (error) {
    sendJson(req, res, error.statusCode || 500, {
      error: error.message,
      code: error.code || "internal_error",
      detail: error.detail || {}
    });
  }
});

server.listen(port, host, () => {
  console.log(`account-system listening on http://${host}:${port}${basePath}`);
});

function requireSession(req) {
  const session = store.getSession(getBearerToken(req));
  if (!session) {
    const error = new Error("unauthorized");
    error.statusCode = 401;
    error.code = "unauthorized";
    throw error;
  }
  return session;
}

function requireCapability(session, capability) {
  if (!session.user.capabilities?.[capability]) {
    const error = new Error(`${capability} permission required`);
    error.statusCode = 403;
    error.code = "permission_denied";
    throw error;
  }
}

function getBearerToken(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        const error = new Error("payload too large");
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const error = new Error("invalid json");
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(req, res, 405, { error: "method not allowed" });
    return;
  }

  const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const routeFile = {
    "": "login.html",
    login: "login.html",
    dashboard: "dashboard.html"
  }[cleanPath] || cleanPath;
  const requestedPath = path.normalize(routeFile || "login.html");
  if (requestedPath.startsWith("..")) {
    sendJson(req, res, 403, { error: "forbidden" });
    return;
  }

  let filePath = path.join(publicDir, requestedPath);
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    filePath = path.join(publicDir, "index.html");
  }

  const body = await fs.readFile(filePath);
  res.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=3600",
    "content-length": body.length
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

function sendJson(req, res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    ...corsHeaders(req)
  });
  res.end(payload);
}

function handleCors(req, res) {
  if (req.method !== "OPTIONS") {
    return false;
  }
  res.writeHead(204, {
    ...corsHeaders(req),
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-max-age": "86400"
  });
  res.end();
  return true;
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (origin !== allowedOrigin) {
    return {};
  }
  return {
    "access-control-allow-origin": allowedOrigin,
    "vary": "Origin"
  };
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".webp")) return "image/webp";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  return "text/html; charset=utf-8";
}

function normalizeBasePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") : `/${trimmed.replace(/\/+$/, "")}`;
}

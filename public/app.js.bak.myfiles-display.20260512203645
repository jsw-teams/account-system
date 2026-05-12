const apiBase = location.hostname === "account.js.gripe"
  ? "https://gateway.js.gripe/api/v1/myaccount"
  : "/api/v1/myaccount";

const state = {
  initialized: false,
  token: localStorage.getItem("account_token") || "",
  expiresAt: "",
  lang: localStorage.getItem("account_lang") || "zh-CN",
  user: null,
  view: "settings",
  userFilter: "all",
  users: [],
  clients: []
};

const i18n = {
  "zh-CN": {
    skip: "跳到登录表单",
    skipDashboard: "跳到主内容",
    setupTitle: "创建系统管理员",
    loginTitle: "登录账户中心",
    registerTitle: "注册统一账户",
    email: "邮箱",
    displayName: "显示名",
    password: "密码",
    confirmPassword: "确认密码",
    finishSetup: "完成初始化",
    signIn: "登录",
    createAccount: "自主注册",
    registerAndContinue: "注册并继续",
    backToLogin: "返回登录",
    logout: "退出",
    usersNav: "用户管理",
    clientsNav: "API 接入",
    auditNav: "审计日志",
    settingsNav: "个人设置",
    authorizePrefix: "登录后将授权第三方应用：",
    confirmTitle: "确认账户",
    continueAccount: "继续使用该账户",
    switchAccount: "切换账户",
    forgetAccount: "让此浏览器忘记该账户",
    forgottenAccount: "此浏览器已忘记该账户",
    confirmAuthorize: "当前已登录 {email}。确认后将授权第三方应用：{client}",
    confirmDashboard: "当前已登录 {email}。确认后进入账户中心，或切换为其他账户。",
    passwordMismatch: "两次密码不一致",
    adminCreated: "系统管理员已创建",
    accountCreated: "账户已创建",
    userManagement: "用户管理",
    apiAccess: "API 接入",
    auditLogs: "审计日志",
    settings: "个人设置",
    noUsers: "没有符合条件的用户",
    noApis: "还没有 API 接入凭据",
    noAudit: "暂无审计日志"
  },
  en: {
    skip: "Skip to sign-in form",
    skipDashboard: "Skip to main content",
    setupTitle: "Create system administrator",
    loginTitle: "Sign in to Account Center",
    registerTitle: "Create unified account",
    email: "Email",
    displayName: "Display name",
    password: "Password",
    confirmPassword: "Confirm password",
    finishSetup: "Finish setup",
    signIn: "Sign in",
    createAccount: "Create account",
    registerAndContinue: "Register and continue",
    backToLogin: "Back to sign in",
    logout: "Sign out",
    usersNav: "Users",
    clientsNav: "API access",
    auditNav: "Audit logs",
    settingsNav: "Settings",
    authorizePrefix: "After sign-in, you will authorize:",
    confirmTitle: "Confirm account",
    continueAccount: "Continue with this account",
    switchAccount: "Switch account",
    forgetAccount: "Forget this account in this browser",
    forgottenAccount: "This browser forgot the account",
    confirmAuthorize: "You are signed in as {email}. Continue to authorize: {client}",
    confirmDashboard: "You are signed in as {email}. Continue to Account Center, or switch accounts.",
    passwordMismatch: "The two passwords do not match",
    adminCreated: "System administrator created",
    accountCreated: "Account created",
    userManagement: "User management",
    apiAccess: "API access",
    auditLogs: "Audit logs",
    settings: "Settings",
    noUsers: "No users match this filter",
    noApis: "No API clients yet",
    noAudit: "No audit logs yet"
  }
};

const roleLabels = {
  system_admin: "系统管理员",
  operator: "运营管理员",
  auditor: "审计员",
  member: "成员"
};

const roleLabelsEn = {
  system_admin: "System admin",
  operator: "Operator",
  auditor: "Auditor",
  member: "Member"
};

const roleDescriptions = {
  system_admin: "统一账户、API 接入凭据和审计",
  operator: "用户创建、停用、重置密码和身份绑定",
  auditor: "只读查看审计记录",
  member: "仅维护自己的账户设置"
};

const roleDescriptionsEn = {
  system_admin: "Unified accounts, API credentials, and audit",
  operator: "User creation, disabling, password reset, and identity linking",
  auditor: "Read-only audit log access",
  member: "Maintain personal account settings only"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const isLoginPage = document.body.dataset.page === "login";
const isDashboardPage = document.body.dataset.page === "dashboard";

bindSharedControls();
applyLanguage();

if (isLoginPage) {
  bootLogin().catch(showBootError);
}

if (isDashboardPage) {
  bootDashboard().catch(showDashboardBootError);
}

function bindSharedControls() {
  $("[data-logout]")?.addEventListener("click", logout);
  $$("[data-lang]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.lang = button.dataset.lang;
      localStorage.setItem("account_lang", state.lang);
      applyLanguage();
      if (isDashboardPage && state.user) {
        renderShell();
        await renderView();
      }
    });
  });
  $$("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });
  $$("[data-choice-group]").forEach((group) => {
    group.addEventListener("click", (event) => {
      const button = event.target.closest(".choice");
      if (!button) return;
      group.querySelectorAll(".choice").forEach((item) => item.classList.toggle("active", item === button));
      group.parentElement.querySelector("input[type='hidden']").value = button.dataset.value;
    });
  });
}

async function bootLogin() {
  const auth = authRequest();
  const status = await request("/setup/status", { auth: false });
  state.initialized = status.initialized;
  $("#setup-form").classList.toggle("hidden", state.initialized);
  $("#login-form").classList.toggle("hidden", !state.initialized);

  $("#setup-form").addEventListener("submit", setupFirstAdmin);
  $("#login-form").addEventListener("submit", login);
  $("#register-form")?.addEventListener("submit", register);
  $("#show-register")?.addEventListener("click", () => showAuthForm("register"));
  $("#show-login")?.addEventListener("click", () => showAuthForm("login"));
  $("#continue-session")?.addEventListener("click", continueExistingSession);
  $("#switch-session")?.addEventListener("click", switchExistingSession);
  $("#forget-session")?.addEventListener("click", forgetExistingSession);
  renderAuthorizeContext();

  if (state.initialized && state.token) {
    try {
      const result = await request("/me");
      state.user = result.user;
      state.expiresAt = result.expiresAt;
      if (auth?.prompt === "login") {
        await clearAccountSession();
        showAuthForm("login");
        return;
      }
      showSessionConfirm();
    } catch {
      localStorage.removeItem("account_token");
      state.token = "";
    }
  }
}

async function setupFirstAdmin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const password = String(form.get("password") || "");
  if (password !== String(form.get("confirmPassword") || "")) {
    $("#setup-error").textContent = t("passwordMismatch");
    return;
  }
  try {
    await request("/setup/init", {
      method: "POST",
      auth: false,
      body: {
        email: form.get("email"),
        displayName: form.get("displayName"),
        password
      }
    });
    $("#setup-form").classList.add("hidden");
    $("#login-form").classList.remove("hidden");
    $("#setup-error").textContent = "";
    toast(t("adminCreated"));
  } catch (error) {
    $("#setup-error").textContent = error.message;
  }
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await request("/auth/login", {
      method: "POST",
      auth: false,
      body: {
        email: form.get("email"),
        password: form.get("password")
      }
    });
    await completeLogin(result);
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
}

async function register(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const password = String(form.get("password") || "");
  if (password !== String(form.get("confirmPassword") || "")) {
    $("#register-error").textContent = t("passwordMismatch");
    return;
  }
  try {
    const result = await request("/auth/register", {
      method: "POST",
      auth: false,
      body: {
        email: form.get("email"),
        displayName: form.get("displayName"),
        password
      }
    });
    toast(t("accountCreated"));
    await completeLogin(result);
  } catch (error) {
    $("#register-error").textContent = error.message;
  }
}

async function completeLogin(result) {
  localStorage.setItem("account_token", result.token);
  state.token = result.token;
  state.user = result.user;
  state.expiresAt = result.expiresAt;
  await continueAfterAuth(result);
}

async function continueExistingSession() {
  await continueAfterAuth({
    token: state.token,
    expiresAt: state.expiresAt,
    user: state.user
  });
}

async function switchExistingSession() {
  await clearAccountSession();
  showAuthForm("login");
}

async function forgetExistingSession() {
  await clearAccountSession();
  showAuthForm("login");
  toast(t("forgottenAccount"));
}

async function continueAfterAuth(loginResult) {
  const auth = authRequest();
  if (!auth) {
    location.replace("/dashboard");
    return;
  }
  const result = await request("/auth/authorize", {
    method: "POST",
    body: {
      clientId: auth.clientId,
      redirectUri: auth.redirectUri,
      scope: auth.scope,
      state: auth.state,
      expiresAt: loginResult.expiresAt
    }
  });
  location.replace(result.callbackUrl);
}

async function bootDashboard() {
  if (!state.token) {
    location.replace("/login");
    return;
  }
  const result = await request("/me");
  state.user = result.user;
  chooseInitialView();
  bindDashboardControls();
  renderShell();
  await renderView();
}

function bindDashboardControls() {
  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", async () => {
      state.view = button.dataset.view;
      renderShell();
      await renderView();
    });
  });

  $("#create-user-button")?.addEventListener("click", () => $("#user-dialog").showModal());
  $("#create-client-button")?.addEventListener("click", () => $("#client-dialog").showModal());
  $("#refresh-audit-button")?.addEventListener("click", renderAudit);
  $("#audit-limit")?.addEventListener("change", renderAudit);
  $("#generate-user-password")?.addEventListener("click", () => {
    $("#user-form").elements.password.value = generatePassword();
  });

  $("#user-filter")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.userFilter = button.dataset.filter;
    $$("#user-filter .segment").forEach((item) => item.classList.toggle("active", item === button));
    renderUsersFromState();
  });

  $("#users-grid")?.addEventListener("click", handleUserAction);
  $("#disable-user-form")?.addEventListener("submit", disableUser);
  $("#delete-user-form")?.addEventListener("submit", deleteUser);
  $("#clients-grid")?.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-api-action]");
    if (!action) return;
    const apiId = action.closest("[data-api-id]")?.dataset.apiId;
    if (apiId && action.dataset.apiAction === "delete") {
      await deleteApi(apiId);
    }
  });
  $("#client-presets")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (button) applyClientPreset(button.dataset.preset);
  });

  $("#user-form")?.addEventListener("submit", createUser);
  $("#client-form")?.addEventListener("submit", createClient);
  $("#profile-form")?.addEventListener("submit", updateProfile);
  $("#password-form")?.addEventListener("submit", changePassword);
  $("#deactivate-account-button")?.addEventListener("click", () => $("#deactivate-dialog").showModal());
  $("#confirm-deactivate-button")?.addEventListener("click", deactivateAccount);
}

function chooseInitialView() {
  const caps = state.user.capabilities || {};
  state.view = caps.users ? "users" : caps.clients ? "clients" : caps.audit ? "audit" : "settings";
}

function renderShell() {
  const caps = state.user.capabilities || {};
  $$(".nav-button").forEach((button) => {
    const view = button.dataset.view;
    const allowed = view === "settings" || Boolean(caps[view]);
    button.classList.toggle("hidden", !allowed);
    button.classList.toggle("active", state.view === view);
  });
  $$(".view").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.viewPanel !== state.view));
  $("#current-user").textContent = `${state.user.displayName} / ${roleLabel(state.user.role)}`;
  const profileInput = $("#profile-form")?.elements.displayName;
  if (profileInput && document.activeElement !== profileInput) {
    profileInput.value = state.user.displayName;
  }
  $("#view-title").textContent = {
    users: t("userManagement"),
    clients: t("apiAccess"),
    audit: t("auditLogs"),
    settings: t("settings")
  }[state.view];
  $("#must-change")?.classList.toggle("hidden", !state.user.mustChangePassword);
  renderRoleCard();
}

async function renderView() {
  if (state.view === "users") return renderUsers();
  if (state.view === "clients") return renderClients();
  if (state.view === "audit") return renderAudit();
}

function renderRoleCard() {
  $("#role-title").textContent = roleLabel(state.user.role);
  $("#role-detail").textContent = roleDescription(state.user.role);
  const caps = state.user.capabilities || {};
  $("#capability-list").innerHTML = [
    [t("usersNav"), caps.users],
    [t("clientsNav"), caps.clients],
    [t("auditNav"), caps.audit],
    [t("settingsNav"), true]
  ].map(([label, enabled]) => `<span class="cap ${enabled ? "on" : ""}">${label}</span>`).join("");
}

async function renderUsers() {
  const { users } = await request("/users");
  state.users = users;
  renderUsersFromState();
}

function renderUsersFromState() {
  const users = state.userFilter === "all"
    ? state.users
    : state.users.filter((user) => user.role === state.userFilter);
  $("#users-grid").innerHTML = users.map((user) => `
    <article class="item-card" data-user-id="${escapeHtml(user.id)}">
      <div class="item-head">
        <div>
          <div class="item-title">${escapeHtml(user.displayName)}</div>
          <div class="meta">${escapeHtml(user.email)}</div>
        </div>
        <span class="badge ${user.mustChangePassword ? "warn" : ""}">${escapeHtml(roleLabel(user.role))}</span>
      </div>
      <div class="meta">${escapeHtml(statusLabel(user.status))} / ${formatTime(user.createdAt)}</div>
      ${user.disabledReason ? `<div class="meta danger-text">停用原因：${escapeHtml(user.disabledReason)}</div>` : ""}
      <div class="meta">${escapeHtml(roleDescription(user.role))}</div>
      ${renderUserActions(user)}
    </article>
  `).join("") || `<div class="empty-state">${escapeHtml(t("noUsers"))}</div>`;
}

function renderUserActions(user) {
  if (user.role === "system_admin") {
    return `<div class="protected-note">系统管理员账户受保护，不允许在用户管理中停用、降级或删除。</div>`;
  }
  return `
    <div class="card-actions">
      <button class="ghost" data-user-action="${user.status === "active" ? "open-disable" : "enable"}">${user.status === "active" ? "停用" : "启用"}</button>
      <button class="ghost" data-user-action="promote">${nextRoleLabel(user.role)}</button>
      <button class="danger action-danger" data-user-action="open-delete">删除</button>
    </div>
  `;
}

async function handleUserAction(event) {
  const action = event.target.closest("[data-user-action]");
  if (!action) return;
  const userId = action.closest("[data-user-id]")?.dataset.userId;
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;
  const body = {
    displayName: user.displayName,
    metadata: user.metadata || {},
    role: user.role,
    status: user.status
  };
  if (action.dataset.userAction === "open-disable") {
    const form = $("#disable-user-form");
    form.elements.userId.value = user.id;
    form.elements.reason.value = user.disabledReason || "";
    $("#disable-user-name").textContent = `${user.displayName} / ${user.email}`;
    $("#disable-user-dialog").showModal();
    return;
  }
  if (action.dataset.userAction === "open-delete") {
    const form = $("#delete-user-form");
    form.elements.userId.value = user.id;
    $("#delete-user-name").textContent = `${user.displayName} / ${user.email}`;
    $("#delete-user-dialog").showModal();
    return;
  }
  if (action.dataset.userAction === "enable") {
    body.status = "active";
  }
  if (action.dataset.userAction === "promote") {
    body.role = nextRole(user.role);
  }
  await request(`/users/${encodeURIComponent(userId)}`, { method: "PATCH", body });
  toast("用户已更新");
  await renderUsers();
}

async function disableUser(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const userId = String(form.get("userId") || "");
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;
  const result = await request(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: {
      displayName: user.displayName,
      metadata: user.metadata || {},
      role: user.role,
      status: "disabled",
      disabledReason: form.get("reason")
    }
  });
  closeDialog("#disable-user-dialog");
  formElement.reset();
  toast(`账户已停用：${result.user.disabledReason}`);
  await renderUsers();
}

async function deleteUser(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const userId = String(form.get("userId") || "");
  await request(`/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
  closeDialog("#delete-user-dialog");
  formElement.reset();
  toast("账户已删除，可重新使用相同邮箱注册");
  await renderUsers();
}

async function renderClients() {
  const { apis } = await request("/apis");
  state.clients = apis;
  $("#clients-grid").innerHTML = apis.map((client) => `
    <article class="item-card" data-api-id="${escapeHtml(client.id)}">
      <div class="item-head">
        <div>
          <div class="item-title">${escapeHtml(client.name)}</div>
          <div class="meta">${escapeHtml(client.id)}</div>
        </div>
        <span class="badge">${escapeHtml(statusLabel(client.status))}</span>
      </div>
      <div class="chip-grid">${client.scopes.map((scope) => `<span class="chip static"><span>${escapeHtml(scope)}</span></span>`).join("")}</div>
      <div class="meta">${escapeHtml(client.redirectUris.join(", ") || "-")}</div>
      <div class="card-actions">
        <button class="danger" data-api-action="delete">删除</button>
      </div>
    </article>
  `).join("") || `<div class="empty-state">${escapeHtml(t("noApis"))}</div>`;
}

async function renderAudit() {
  const { logs } = await request(`/audit-logs?limit=${$("#audit-limit").value}`);
  $("#audit-list").innerHTML = logs.map((log) => `
    <div class="audit-row">
      <div>${formatTime(log.createdAt)}</div>
      <div><strong>${escapeHtml(log.action)}</strong><div class="meta">${escapeHtml(log.actorUserId || "system")}</div></div>
      <div class="meta">${escapeHtml(log.targetType)} / ${escapeHtml(log.targetId)}</div>
    </div>
  `).join("") || `<div class="empty-state">${escapeHtml(t("noAudit"))}</div>`;
}

async function createUser(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const result = await request("/users", {
    method: "POST",
    body: {
      email: form.get("email"),
      displayName: form.get("displayName"),
      password: form.get("password") || undefined,
      role: form.get("role"),
      status: form.get("status") ? "active" : "disabled"
    }
  });
  closeDialog("#user-dialog");
  formElement.reset();
  resetChoices("#user-form");
  toast(result.user.initialPassword ? `初始密码：${result.user.initialPassword}` : "用户已创建");
  await renderUsers();
}

async function createClient(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const result = await request("/apis", {
    method: "POST",
    body: {
      name: form.get("name"),
      redirectUris: lines(form.get("redirectUris")),
      scopes: selectedScopes()
    }
  });
  closeDialog("#client-dialog");
  formElement.reset();
  $("#client-secret").textContent = result.api.clientSecret;
  $("#secret-dialog").showModal();
  await renderClients();
}

async function deleteApi(apiId) {
  await request(`/apis/${encodeURIComponent(apiId)}`, { method: "DELETE" });
  toast("API 接入凭据已删除");
  await renderClients();
}

async function updateProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await request("/me", {
    method: "PATCH",
    body: {
      displayName: form.get("displayName")
    }
  });
  state.user = result.user;
  toast("账户资料已更新");
  renderShell();
  if (state.view === "users") {
    await renderUsers();
  }
}

async function changePassword(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await request("/me/password", {
    method: "POST",
    body: {
      currentPassword: form.get("currentPassword"),
      newPassword: form.get("newPassword")
    }
  });
  state.user = result.user;
  event.currentTarget.reset();
  toast("密码已更新");
  renderShell();
}

async function deactivateAccount() {
  await request("/me/deactivate", { method: "POST" });
  localStorage.removeItem("account_token");
  state.token = "";
  state.user = null;
  location.replace("/login");
}

async function logout() {
  await clearAccountSession();
  location.replace("/login?prompt=login");
}

async function clearAccountSession() {
  try {
    await request("/auth/logout", { method: "POST" });
  } catch {
    // Local cleanup still matters if the remote session already expired.
  }
  localStorage.removeItem("account_token");
  state.token = "";
  state.expiresAt = "";
  state.user = null;
}

function selectedScopes() {
  return $$("#client-scopes input:checked").map((item) => item.value);
}

function closeDialog(selector) {
  const dialog = $(selector);
  if (dialog?.open) dialog.close();
}

function resetChoices(scope) {
  $$(`${scope} [data-choice-group]`).forEach((group) => {
    const first = group.querySelector(".choice");
    group.querySelectorAll(".choice").forEach((item) => item.classList.toggle("active", item === first));
    group.parentElement.querySelector("input[type='hidden']").value = first.dataset.value;
  });
}

function applyClientPreset(name) {
  const presets = {
    read: {
      redirectUris: "",
      scopes: ["accounts:read"]
    },
    identity: {
      redirectUris: "",
      scopes: ["accounts:read", "identities:resolve", "identities:link"]
    },
    service: {
      redirectUris: "",
      scopes: ["accounts:read", "users:read", "identities:resolve"]
    }
  };
  const preset = presets[name];
  if (!preset) return;
  const form = $("#client-form");
  form.elements.name.value = name;
  form.elements.redirectUris.value = preset.redirectUris;
  $$("#client-scopes input").forEach((input) => {
    input.checked = preset.scopes.includes(input.value);
  });
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (options.auth !== false && state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function nextRole(role) {
  return {
    member: "operator",
    operator: "auditor",
    auditor: "system_admin",
    system_admin: "member"
  }[role] || "member";
}

function nextRoleLabel(role) {
  return state.lang === "zh-CN" ? `改为${roleLabel(nextRole(role))}` : `Change to ${roleLabel(nextRole(role))}`;
}

function statusLabel(status) {
  return status === "active" ? (state.lang === "zh-CN" ? "启用" : "Active") : (state.lang === "zh-CN" ? "停用" : "Disabled");
}

function lines(value) {
  return String(value || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

function generatePassword() {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("") + "A1!";
}

function formatTime(value) {
  return new Intl.DateTimeFormat(state.lang, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.remove("hidden");
  setTimeout(() => $("#toast").classList.add("hidden"), 5200);
}

function showAuthForm(name) {
  $("#session-confirm")?.classList.add("hidden");
  $("#login-form")?.classList.toggle("hidden", name !== "login");
  $("#register-form")?.classList.toggle("hidden", name !== "register");
}

function showSessionConfirm() {
  $("#setup-form")?.classList.add("hidden");
  $("#login-form")?.classList.add("hidden");
  $("#register-form")?.classList.add("hidden");
  const panel = $("#session-confirm");
  if (!panel) return;
  const auth = authRequest();
  const email = state.user?.email || state.user?.displayName || "account";
  const template = auth ? t("confirmAuthorize") : t("confirmDashboard");
  $("#session-confirm-copy").textContent = template
    .replace("{email}", email)
    .replace("{client}", auth?.clientId || "Account Center");
  panel.classList.remove("hidden");
}

function authRequest() {
  const params = new URLSearchParams(location.search);
  const clientId = params.get("client_id") || params.get("clientId");
  const redirectUri = params.get("redirect_uri") || params.get("redirectUri");
  if (!clientId || !redirectUri) {
    return null;
  }
  return {
    clientId,
    redirectUri,
    scope: params.get("scope") || "",
    state: params.get("state") || "",
    prompt: params.get("prompt") || ""
  };
}

function renderAuthorizeContext() {
  const target = $("#authorize-context");
  if (!target) return;
  const auth = authRequest();
  target.classList.toggle("hidden", !auth);
  if (auth) {
    target.textContent = `${t("authorizePrefix")} ${auth.clientId}`;
  }
}

function applyLanguage() {
  document.documentElement.lang = state.lang;
  $$("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  $$("[data-lang]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.lang === state.lang));
  });
  renderAuthorizeContext();
}

function t(key) {
  return i18n[state.lang]?.[key] || i18n["zh-CN"][key] || key;
}

function roleLabel(role) {
  return (state.lang === "zh-CN" ? roleLabels : roleLabelsEn)[role] || role;
}

function roleDescription(role) {
  return (state.lang === "zh-CN" ? roleDescriptions : roleDescriptionsEn)[role] || "";
}

function showBootError(error) {
  $("#login-form").classList.remove("hidden");
  $("#login-error").textContent = error.message;
}

function showDashboardBootError(error) {
  localStorage.removeItem("account_token");
  const target = `/login?error=${encodeURIComponent(error.message)}`;
  location.replace(target);
}

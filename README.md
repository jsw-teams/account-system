# Account System

统一账户中心，用于集中管理 JS.Gripe 体系内的用户、第三方身份绑定和 API 接入凭据。Web 控制台分配给 `https://account.js.gripe`，后端 API 分配给 `https://gateway.js.gripe/api/v1/myaccount`。

账户系统只负责统一账户管理和第三方项目通过 API 接入，不负责管理 dquery、mypicture 等业务项目的 DNS、图片、相册、规则、上传记录或其他业务数据。业务项目拿到账户中心返回的 `user.id` 后，在自己的系统内完成业务管理。

当前交付形态：

- 后端：Node.js 20+，无外部 npm 依赖
- 数据库：本地 SQLite3，默认 `data/accounts.sqlite3`
- 登录：独立登录页 `/login`，初始化时创建第一个系统管理员，登录后使用 Bearer session token
- 第三方授权：第三方可跳转到 `/login` 完成统一账户登录或注册，授权成功后回跳注册的 `redirect_uri` 并返回账户 session
- 注册：初始化完成后开放自主注册，注册账户固定为 `member`
- 前端：独立控制台 `/dashboard`，按用户类型展示账户、API 接入和审计操作，登录页和控制台支持中文/英文切换、键盘跳转和可访问焦点状态
- 网关：OpenResty 反代配置示例已提供
- 后续接入：预留 OAuth/OIDC 接入路径

## 2026-05 重写设计思路

本次重写把账户中心拆成“独立登录入口 + 独立控制台入口”：

- `/login` 只负责系统初始化、登录、自主注册和第三方授权回跳，不混入后台操作。
- `/dashboard` 只负责登录后的账户控制台，未登录会回到登录页。
- 初始化流程只在空数据库时出现，第一个账户固定为 `system_admin`。
- 控制台展示完全由后端返回的 `capabilities` 控制，前端只负责裁剪导航和交互，后端仍做权限拦截。
- 交互尽量使用按钮组、分段控件、开关、下拉和权限 chip，减少需要手填的文本；密码、邮箱、回调 URL 这类天然文本字段保留输入框。
- 为避免旧表结构、旧角色名和旧测试数据影响新权限模型，本次部署建议删除旧 SQLite 数据后重新初始化。

用户类型：

| 类型 | 控制台 | 权限 |
| --- | --- | --- |
| `system_admin` | 用户、API 接入、审计、个人 | 全量账户管理，创建和删除第三方 API 凭据 |
| `operator` | 用户、个人 | 创建用户、停用账户、调整用户类型、重置身份归属 |
| `auditor` | 审计、个人 | 只读查看审计日志 |
| `member` | 个人 | 修改自己的密码和查看账户状态 |

## 生产部署

安装前确认系统已有 Node.js、npm 和 sqlite3：

```bash
node --version
npm --version
sqlite3 --version
```

首次启动：

```bash
cd /opt/account-system
ACCOUNT_HOST=127.0.0.1 \
ACCOUNT_PORT=9100 \
ACCOUNT_BASE_PATH=/api/v1/myaccount \
ACCOUNT_ALLOWED_ORIGIN=https://account.js.gripe \
ACCOUNT_DB_PATH=/opt/account-system/data/accounts.sqlite3 \
npm start
```

第一次访问控制台时，如果数据库中还没有用户，Web UI 会进入 setup 流程。请在页面中自定义第一个系统管理员邮箱、显示名和密码；后端不会自动创建默认账户。

重建部署时删除旧数据：

```bash
sudo systemctl stop account-system.service
rm -f /opt/account-system/data/accounts.sqlite3 \
  /opt/account-system/data/accounts.sqlite3-wal \
  /opt/account-system/data/accounts.sqlite3-shm
sudo systemctl start account-system.service
```

然后访问 `https://account.js.gripe/login`，完成系统管理员创建，再登录 `https://account.js.gripe/dashboard` 检查用户、API 接入、审计、个人设置是否可交互。

## systemd

```bash
sudo cp /opt/account-system/systemd/account-system.service /etc/systemd/system/account-system.service
sudo systemctl daemon-reload
sudo systemctl enable --now account-system.service
```

查看状态：

```bash
systemctl status account-system.service
journalctl -u account-system.service -f
```

## OpenResty

控制台域名 `account.js.gripe`：

```bash
sudo cp /opt/account-system/openresty/account-system.conf /usr/local/openresty/nginx/conf/conf.d/account-system.conf
```

后端 API 已在 `/opt/deploy-hooks/openresty/gateway.js.gripe.conf` 中加入：

```text
https://gateway.js.gripe/api/v1/myaccount
```

重载前先检查配置：

```bash
sudo openresty -t
sudo systemctl reload openresty
```

## 数据库自查

账户服务使用 SQLite3，本地自检命令：

```bash
ACCOUNT_DB_PATH=/opt/account-system/data/accounts.sqlite3 npm run db:check
```

自检会执行：

- `PRAGMA integrity_check`
- `PRAGMA foreign_key_check`
- 输出当前表清单

运行时数据文件已经被 `.gitignore` 排除，不要提交 `data/accounts.sqlite3`。

## API

基础地址：

```text
https://gateway.js.gripe/api/v1/myaccount
```

### 登录

```bash
curl -X POST https://gateway.js.gripe/api/v1/myaccount/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<system-email>","password":"<system-password>"}'
```

返回：

```json
{
  "token": "...",
  "expiresAt": "2026-05-20T00:00:00.000Z",
  "user": {
    "id": "usr_...",
    "email": "root@account.local",
    "role": "system_admin",
    "userType": "system_admin",
    "capabilities": {
      "users": true,
      "clients": true,
      "audit": true,
      "settings": true
    }
  }
}
```

### 自主注册

初始化完成后，用户可以在 `https://account.js.gripe/login` 自主注册统一账户。注册账户固定为 `member`，注册成功后会直接返回登录 session：

```bash
curl -X POST https://gateway.js.gripe/api/v1/myaccount/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "displayName": "Alice",
    "password": "ChangeMe123!"
  }'
```

返回结构与登录相同，包含 `token`、`expiresAt` 和 `user`。已停用账户占用的邮箱不能重新注册，只有管理员删除账户后才允许复用邮箱。

### 第三方跳转授权登录

第三方应用先由系统管理员在账户中心创建 API 接入，并登记允许的 `redirectUris`。用户访问第三方应用时，第三方将用户跳转到账户中心登录页：

```text
https://account.js.gripe/login?client_id=<clientId>&redirect_uri=https%3A%2F%2Fthird.example%2Fauth%2Fcallback&scope=accounts%3Aread%20identities%3Aresolve&state=<opaque-state>&prompt=consent
```

参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `client_id` | 是 | 账户中心 API 接入 ID。 |
| `redirect_uri` | 是 | 必须与该 API 接入登记的回调地址完全一致。 |
| `scope` | 否 | 空格分隔的权限范围，必须是该 API 接入已拥有的 scope 子集。 |
| `state` | 建议 | 第三方生成的防 CSRF 随机值，账户中心会原样带回。 |
| `prompt` | 否 | 建议第三方传 `consent`，已有账户中心登录态时也会展示账户确认页；传 `login` 时会先清理当前浏览器登录态并要求重新登录。 |

用户可以登录已有账户，也可以在登录页自主注册。授权成功后，账户中心会回跳：

```text
https://third.example/auth/callback?state=<opaque-state>&account_session=<token>&token_type=Bearer&expires_at=<iso-time>&user_id=<usr_id>&scope=<granted-scopes>
```

第三方拿到 `account_session` 后，可以在服务端以 `Authorization: Bearer <account_session>` 调用 `/me` 获取账户资料，或按业务需要保存 `user_id` 作为 owner key。回调必须使用 HTTPS，第三方必须校验 `state`，并避免把 `account_session` 写入日志、前端持久存储或公开错误页。

已登录账户中心的用户访问授权 URL 时，不再静默回跳第三方。登录页会展示当前账户确认面板，用户可以继续使用该账户、切换账户，或让此浏览器忘记该账户。确认继续后才会调用 `/auth/authorize` 并回跳第三方。

第三方应用建议使用小窗打开账户中心登录页。只有用户关闭小窗且没有完成授权时，第三方才应该显示“未授权”或“授权未完成”；登录页加载、账户确认和成功回跳过程中不应提前展示失败状态。成功回调后第三方应校验 `state`，保存本次浏览器会话需要的 `account_session`，然后进入自己的业务控制台。

后续管理接口使用：

```http
Authorization: Bearer <token>
Content-Type: application/json
```

### 创建统一用户

```bash
curl -X POST https://gateway.js.gripe/api/v1/myaccount/users \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","displayName":"Alice","role":"member"}'
```

如果未传 `password`，系统会自动生成初始密码，并在响应里的 `initialPassword` 返回一次。

### 停用与删除用户

停用是账户封禁语义：数据保留，邮箱和第三方身份绑定继续占用，不能用相同信息重新注册。停用必须填写原因，用户再次登录或第三方项目解析身份时会收到明确的 `account_disabled` 错误。

```bash
curl -X PATCH https://gateway.js.gripe/api/v1/myaccount/users/<userId> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Alice",
    "role": "member",
    "status": "disabled",
    "disabledReason": "账户已停用。如需恢复，请联系 helper@js.gripe 支持团队。"
  }'
```

删除是彻底移除账户：用户、会话和第三方身份绑定会被删除，之后允许使用相同邮箱或第三方身份重新注册。审计日志会保留删除动作。

```bash
curl -X DELETE https://gateway.js.gripe/api/v1/myaccount/users/<userId> \
  -H "Authorization: Bearer <token>"
```

自主注销会走停用语义，而不是删除语义。用户注销后看到的恢复提示应引导联系 `helper@js.gripe` 支持团队。

系统管理员账户受保护，不能在用户管理中被停用、删除或降级，避免误操作影响账户系统稳定性。需要调整系统管理员时，应先创建并验证新的 `system_admin` 账户，再通过受控维护流程处理旧账户。

### 绑定第三方身份

```bash
curl -X POST https://gateway.js.gripe/api/v1/myaccount/users/<userId>/identities \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "github",
    "providerSubject": "123456",
    "profile": {
      "login": "alice",
      "avatarUrl": "https://github.com/alice.png"
    }
  }'
```

### 解析第三方身份

```bash
curl "https://gateway.js.gripe/api/v1/myaccount/identity/resolve?provider=github&providerSubject=123456" \
  -H "Authorization: Bearer <token>"
```

### 新增 API 接入

```bash
curl -X POST https://gateway.js.gripe/api/v1/myaccount/apis \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "service-api",
    "redirectUris": ["https://example.com/auth/callback"],
    "scopes": ["accounts:read", "identities:resolve"]
  }'
```

返回里的 `clientSecret` 只出现一次，需要保存到接入方服务端配置。

### 删除 API 接入

```bash
curl -X DELETE https://gateway.js.gripe/api/v1/myaccount/apis/<apiId> \
  -H "Authorization: Bearer <token>"
```

删除后该 API 凭据不能继续通过 `/apis/verify` 校验。

## 第三方接入建议

第三方系统接入账户中心时，建议按下面流程做，避免不同平台重复创建用户。

1. 第三方项目先在账户中心新增 API 接入，拿到 `clientId` 和 `clientSecret`。
2. 在 API 接入中登记允许的 `redirectUris` 和所需 `scopes`。
3. 第三方项目服务端保存 API 凭据，启动时或定期调用 `/apis/verify` 校验凭据有效。
4. 推荐把用户跳转到 `https://account.js.gripe/login?client_id=...&redirect_uri=...&state=...` 完成统一登录授权。
5. 如仍需绑定外部身份，第三方项目完成自己的登录流程，例如 GitHub OAuth、Google OAuth、企业微信登录或内部 SSO。
6. 第三方项目拿到稳定且唯一的外部用户 ID，映射为：
   - `provider`：平台标识，例如 `github`、`google`、`wechat-work`、`internal-sso`
   - `providerSubject`：该平台返回的稳定用户 ID，例如 GitHub numeric id、Google `sub`、企业微信 `userid`
7. 第三方项目调用 `/identity/resolve` 查询这个外部身份是否已经绑定统一账户。
8. 如果已绑定且用户状态为 active，使用返回的 `user.id` 作为内部 owner key。
9. 如果返回 `account_disabled`，不要创建新账户，也不要把错误显示成“密码错误”。应提示账户已停用、显示返回的 `disabledReason`，并引导联系 `helper@js.gripe`。
10. 如果未绑定，应进入账户绑定或创建流程：
   - 已登录过账户中心的用户：调用 `/users/<userId>/identities` 绑定外部身份。
   - 新用户：先调用 `/users` 创建统一用户，再绑定外部身份。
11. 业务系统只保存账户中心的 `user.id`，不要把 GitHub ID、Google sub 等平台 ID 当作业务主键。

接入时还建议遵守这些规则：

- `providerSubject` 必须使用第三方平台的不可变 ID，不要使用昵称、邮箱或用户名。
- 邮箱只能作为辅助信息，不能作为跨平台唯一身份依据，因为邮箱可能变更或被复用。
- 一个外部身份只能绑定一个统一用户；如果需要转移绑定，先人工审核再解绑重绑。
- 第三方回调必须使用 HTTPS，并校验 `state`、`nonce`、回调域名和客户端凭据。
- API 密钥只在服务端保存，不要放进浏览器、App 包或公开仓库。

## 前端多语言、无障碍和性能

- 登录页和控制台提供中文/英文切换，选择会保存在浏览器本地。
- 页面包含跳到主内容链接、明确的焦点轮廓、表单错误 `role="alert"`、toast `aria-live` 和语义化表单标签。
- 登录页主图声明固定尺寸并异步解码，列表卡片使用 `content-visibility` 优化长列表渲染。
- 尊重 `prefers-reduced-motion`，减少动画对敏感用户的影响。

### API 错误处理

错误响应统一包含 `error`、`code` 和 `detail`：

```json
{
  "error": "账户已停用：账户已由用户自主注销。如需恢复，请联系 helper@js.gripe 支持团队。",
  "code": "account_disabled",
  "detail": {
    "disabledReason": "账户已由用户自主注销。如需恢复，请联系 helper@js.gripe 支持团队。",
    "supportEmail": "helper@js.gripe",
    "selfDeactivated": true
  }
}
```

第三方项目应按 `code` 分支处理：

| code | HTTP | 建议处理 |
| --- | --- | --- |
| `bad_credentials` | 401 | 登录凭据错误，可提示重新输入。不要用于停用账户。 |
| `account_disabled` | 403 | 账户停用或自主注销。展示 `disabledReason`，提示联系 `helper@js.gripe`，不要自动创建新账户。 |
| `unauthorized` / `internal_error` | 401/500 | 令牌失效或服务异常，按登录过期或稍后重试处理。 |
| `disabled_reason_required` | 400 | 系统管理停用用户时必须补充停用原因。 |
| `protected_system_admin` | 400 | 系统管理员账户受保护，不能通过用户管理停用、删除或降级。 |
| `email_exists` | 409 | 邮箱已被 active 或 disabled 账户占用；只有删除账户后才允许重新注册。 |
| `identity_not_found` | 404 | 外部身份未绑定统一账户，引导用户绑定或创建统一账户。 |
| `bad_api_credentials` | 401 | API 接入凭据无效或已删除，第三方服务端应停止使用该凭据并提示运维处理。 |

## 业务边界

账户系统提供这些能力：

- 统一用户创建、停用、类型调整和密码维护。
- 第三方身份绑定与解析。
- API 接入凭据创建、删除和校验。
- 账户侧审计日志。

账户系统不提供这些能力：

- 不管理第三方项目的业务资源。
- 不在账户控制台内编辑 DNS 规则、图片资源、相册、上传批次或其他业务配置。
- 不把某个业务项目的权限模型硬编码到账户控制台。

第三方项目应该只保存账户中心的 `user.id` 作为 owner key，并在自己的项目内实现业务控制台和业务权限。

后续建议补标准 OAuth 2.1 / OpenID Connect 授权端点，让 dquery、mypicture 这类业务服务不直接调用管理 API，而是通过授权码流程拿到用户身份。

## 测试

```bash
npm test
```

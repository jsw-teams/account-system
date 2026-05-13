# Account System

`account-system` is the unified JS.Gripe account center. It manages users, browser sessions, API clients, third-party authorization, identity binding, and audit logs.

It does not manage business data for `dquery`, `myfiles`, blogs, picture storage, DNS rules, uploads, or files. Business services store account-system `user.id` as their owner key and manage their own data.

Current production shape:

- Web console: `https://account.js.gripe`
- API base: `https://gateway.js.gripe/api/v1/myaccount`
- Runtime: Node.js 20+
- Database: SQLite
- Frontend: static HTML/CSS/JS in `public/`
- Sessions: bearer tokens stored by the web app, with expiration in SQLite
- Reverse proxy: OpenResty

## Roles

| Role | Purpose |
| --- | --- |
| `system_admin` | Full account, API client, and audit administration |
| `operator` | User operations such as create, disable, role update, identity reset |
| `auditor` | Read-only audit access |
| `member` | Own account settings |

The first user is created through `/login` setup when the database is empty and becomes `system_admin`.

## Main Paths

```text
src/server.mjs              HTTP server and API routing
src/store.mjs               SQLite store and permission logic
public/login.html           setup/login/register/third-party authorization UI
public/dashboard.html       account console
public/app.js               frontend behavior
public/styles.css           pixel UI styles
scripts/db-check.mjs        SQLite integrity check
tests/                      node --test coverage
```

## Environment

Common production environment:

```bash
ACCOUNT_HOST=127.0.0.1
ACCOUNT_PORT=9100
ACCOUNT_BASE_PATH=/api/v1/myaccount
ACCOUNT_ALLOWED_ORIGIN=https://account.js.gripe
ACCOUNT_DB_PATH=/opt/account-system/data/accounts.sqlite3
ACCOUNT_PUBLIC_DIR=/opt/account-system/public
```

Static cache policy:

- `login.html`, `dashboard.html`, and JavaScript are `no-store`.
- Login/dashboard resource references include a version query string.
- Other static assets may be cached briefly.

## Run

```bash
cd /opt/account-system
npm start
```

Production service:

```bash
systemctl status account-system.service
journalctl -u account-system.service -f
```

## Test

```bash
cd /opt/account-system
npm test
ACCOUNT_DB_PATH=/opt/account-system/data/accounts.sqlite3 npm run db:check
```

## API Base

```text
https://gateway.js.gripe/api/v1/myaccount
```

Health:

```bash
curl https://gateway.js.gripe/api/v1/myaccount/healthz
```

Public client lookup used by third-party login pages:

```bash
curl 'https://gateway.js.gripe/api/v1/myaccount/clients/public?client_id=cli_xxx'
```

This endpoint returns the application name so the login panel can display a human-readable app name instead of exposing the raw client id.

## Third-Party Authorization

Create an API client in the dashboard, then send users to:

```text
https://account.js.gripe/login?client_id=<clientId>&redirect_uri=<urlencoded-callback>&scope=accounts%3Aread%20identities%3Aresolve&state=<opaque-state>&prompt=consent
```

Required:

- `client_id`: generated account-system client id
- `redirect_uri`: must exactly match one registered redirect URI

Recommended:

- `scope`: subset of client scopes
- `state`: caller-generated CSRF token
- `prompt=consent`: always show account confirmation before returning

After authorization, account-system redirects to:

```text
<redirect_uri>?state=<state>&account_session=<token>&token_type=Bearer&expires_at=<iso>&user_id=<usr_id>&scope=<scopes>
```

The third-party service should:

- verify `state`
- keep `account_session` server-side or in a short-lived secure app session
- call `/me` with `Authorization: Bearer <account_session>`
- store account-system `user.id` as its owner id
- avoid logging callback query strings

The login UI waits for public client information before allowing the user to continue, so users see the application name rather than the raw client id.

## Client Management

System administrators create API clients in `/dashboard`.

Store these values in the consuming service:

- `client_id`
- one-time `clientSecret` / API key
- registered redirect URI
- allowed scopes

`clientSecret` appears once and cannot be recovered from the UI after closing the creation dialog.

## User Lifecycle

- Self-registration creates `member` users.
- Disabled users keep their email and identity bindings reserved.
- Deleted users release email and identity bindings for re-registration.
- System administrator accounts are protected from destructive user-management actions.
- User self-deactivation is a disabled-account flow, not hard deletion.

## Deployment Notes

To reset all account data during a planned rebuild:

```bash
sudo systemctl stop account-system.service
rm -f /opt/account-system/data/accounts.sqlite3 \
  /opt/account-system/data/accounts.sqlite3-wal \
  /opt/account-system/data/accounts.sqlite3-shm
sudo systemctl start account-system.service
```

Then visit:

```text
https://account.js.gripe/login
```

and create the first `system_admin`.

## Security Notes

- Do not log `account_session` callback query strings.
- Use HTTPS redirect URIs only.
- Third-party apps must validate `state`.
- API calls use bearer tokens.
- Role capabilities are enforced server-side; frontend navigation hiding is only a convenience.
- The account system is identity infrastructure only; business services remain responsible for their own authorization and data policy.

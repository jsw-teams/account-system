# Account System V2 Threat Model

## Scope

In scope: `/opt/account-system` runtime server, SQLite store, static Account Center UI, public discovery metadata, API client management, RBAC, audit logs, and third-party authorization code flow.

Out of scope: OpenResty TLS termination, business application data, and third-party service session implementations.

## System Model

- Browser users interact with static pages in `public/` and API routes in `src/server.mjs`.
- `src/store.mjs` owns SQLite schema version `2`, UUIDv7 entity IDs, password hashing, session token hashing, client secret hashing, authorization code hashing, RBAC, and audit records.
- Third-party services redirect users to `/login`, receive only `code` and optional `state`, then exchange the code at `/auth/token` with client credentials.

## Assets

- Account user records, roles, capabilities, linked identities, and audit logs.
- Password hashes and salts.
- Browser session tokens and third-party access tokens, stored only as hashes in SQLite.
- Authorization codes and client secrets, stored only as hashes in SQLite.
- Registered redirect URIs and client scopes.

## Trust Boundaries

- Public browser to Account Center HTTP API: JSON input, bearer auth for protected routes.
- Account Center UI to SQLite store: trusted server process boundary.
- Third-party redirect callback: untrusted browser URL carrying only authorization code and state.
- Third-party backend to `/auth/token`: client secret based exchange.
- Administrator dashboard to client/user/audit APIs: role-gated by server-side capabilities.

## Threats And Mitigations

| Threat | Likelihood | Impact | Priority | Existing mitigation |
| --- | --- | --- | --- | --- |
| Token leakage through redirect URLs | Medium | High | High | Redirect URL contains only `code` and optional `state`; access tokens are returned only by `/auth/token`. |
| Authorization code replay | Medium | Medium | Medium | Codes are hashed, expire after 5 minutes, and are marked used during exchange. |
| Client impersonation at token exchange | Medium | High | High | `/auth/token` requires matching active client ID and client secret hash. |
| Open redirect to attacker callback | Medium | High | High | `redirect_uri` must exactly match a registered URI and use HTTPS, except local dev hosts. |
| Privilege escalation through UI-only hiding | Medium | High | High | User, client, and audit APIs enforce capabilities server-side. |
| Credential disclosure in logs or docs | Low | High | Medium | Helper script redacts generated client secrets from stdout; README avoids generated secrets. |
| Legacy ID/API compatibility bypass | Low | Medium | Medium | v2 removes prefixed IDs, removes `/apis` aliases, and rebuilds non-v2 schemas. |

## Assumptions

- Production TLS and host routing are handled by OpenResty outside this repository.
- Third-party applications validate `state`, perform code exchange server-side, and issue their own HttpOnly session cookies.
- Operators intentionally accept destructive v2 schema rebuilds and do not need legacy database migration.

## Follow-Up Hardening

- Add rate limiting at the reverse proxy or gateway for login, registration, and token exchange.
- Consider PKCE support for public clients if browser-only third-party integrations are ever allowed.
- Add audit filtering/export controls before exposing audit logs beyond administrators and auditors.
- Consider rotating client secrets through a dedicated endpoint rather than delete/recreate only.

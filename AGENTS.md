# AGENTS.md

## Repository purpose

This repository is JS.Gripe account-system v2. It is the unified account center for account.js.gripe and the gateway API path /api/v1/myaccount.

## Current task type

The current task is a destructive v2 refactor. Do not preserve legacy backend compatibility. Do not patch around the old src/server.mjs + src/store.mjs shape.

## Hard rules

- Work only inside /opt/account-system.
- Do not modify OpenResty certificate paths.
- Do not modify other JS.Gripe projects.
- Do not print real passwords, secrets, tokens, auth codes, access tokens, refresh tokens, or client secrets.
- Do not write generated client_secret values into README.
- Use UUIDv7 for all entity IDs.
- Do not use usr_, cli_, aud_, idn_ ID prefixes.
- Store only hashes for passwords, session tokens, auth codes, access tokens, refresh tokens, and client secrets.
- SSO must use Authorization Code Flow.
- Do not put account_session, access_token, refresh_token, or unified account session tokens in redirect URLs.
- Third-party apps must exchange code server-side and issue their own session cookies.
- Business apps store only account user UUID.

## Required validation

- Run unit/integration tests with `npm test`.
- Run SQLite checks with `npm run db:check`.
- Run Playwright UI smoke with `npm run ui:smoke`.
- Update README with verification notes and screenshots after tests pass.

---
name: account-system-v2-refactor
description: Use for the one-time destructive v2 refactor of jsw-teams/account-system in /opt/account-system. Triggers when rebuilding the account center backend/frontend, UUIDv7 schema, SSO authorization-code flow, RBAC, audit logging, client management, and tests. Do not use for minor bugfixes or compatibility patches.
---

# Account System V2 Refactor Skill

Use this skill to perform a destructive v2 rebuild of account-system.

## Required stance

- Treat this as a clean v2 architecture rebuild.
- Do not preserve legacy backend APIs.
- Do not migrate legacy SQLite schema.
- Do not preserve prefixed IDs such as usr_, cli_, aud_, idn_.
- Use UUIDv7 for all entity IDs.
- Use Authorization Code Flow for SSO.
- Never place access tokens, refresh tokens, account sessions, secrets, or passwords in redirect URLs or logs.

## Required phases

1. Recon existing repo.
2. Write or update AGENTS.md.
3. Design v2 architecture.
4. Rebuild database schema.
5. Implement UUIDv7 ID utilities.
6. Implement auth/session/password.
7. Implement users/RBAC/admin.
8. Implement OAuth-style SSO.
9. Implement client management.
10. Implement audit logs.
11. Rebuild frontend.
12. Run security-best-practices.
13. Run security-threat-model.
14. Run unit/integration tests.
15. Run Playwright UI verification.
16. Update README.
17. Produce FINAL_REPORT.

## Required final commands

Run these before final report:

```bash
npm run build
npm test
npm run db:check
git status
```

If frontend exists:

```bash
npm run build:frontend
npm run build:backend
npm run ui:smoke
```

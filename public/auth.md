# Auth.md

Agent authentication and registration metadata for Account.js.gripe.

Account.js.gripe is a protected account and identity service. It is not suitable for robot crawling, AI training, search indexing, or automated browsing of user/account data. Agents may read this document and the related `.well-known` metadata only to discover authentication requirements.

## Standalone Registration Flow

There is no public self-service agent registration flow. Human users can sign in or register at `https://account.js.gripe/login`. API clients and service credentials are created by an authenticated account administrator in the Account Dashboard.

Agents that need API access must be represented by an authorized user account or an administrator-created API client. Do not attempt credential stuffing, automated sign-up, scraping, or unattended account actions.

## Authentication

Protected APIs are served from `https://gateway.js.gripe/api/v1/myaccount`.

Supported credential patterns:
- Browser session bearer token issued after an interactive sign-in for the Account Center UI.
- OAuth-style authorization code flow for third-party services. Redirect URLs carry only `code` and optional `state`; service backends exchange the code at `/auth/token` with their client secret and then issue their own app session cookies.
- Administrator-created API client credential where an integrating service is approved.

Discovery metadata:
- OAuth authorization server: `https://account.js.gripe/.well-known/oauth-authorization-server`
- OAuth protected resource: `https://account.js.gripe/.well-known/oauth-protected-resource`
- OpenID discovery: `https://account.js.gripe/.well-known/openid-configuration`
- API catalog: `https://account.js.gripe/.well-known/api-catalog`

## Claims

Account records can include email, display name, role, status, capabilities, linked identities, and audit events. These records are protected and must not be crawled or used as AI input without explicit authorization from the account owner and service administrator.

## Revocation

Users can sign out from the Account Center. Administrators can disable users, revoke API clients, and review audit logs from the Account Dashboard.

Support contact: `helper@js.gripe`.

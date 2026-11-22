# KY-FuelPOS — Role-based access v2 implementation plan

Status: design / implementation preparation only. No production migration or deployment.

## Existing implementation (main branch reviewed 2026-11-22)

- React/Vite frontend, tRPC/Hono API, Drizzle/PostgreSQL `pos` schema.
- `staff_users` with `admin | manager | cashier`, Supabase Auth identity, PIN and Passkey.
- `staff_access_groups`, `staff_branches`, menu permissions, login attempts.
- `staffAuth.ts`, `auth.ts`, `authorization.ts`, `middleware.ts`, `guard.ts` already implement authentication and portions of authorization.
- Supabase Auth migration revokes direct table access for anon/authenticated roles. Verify deployed policies separately.

## Compatibility and scope

Keep internal role values `admin | manager | cashier` to avoid breaking existing records and clients. Display Owner / Manager / Staff respectively. Do not confuse business Owner with platform administrator; audit deployment-mode checks before granting any additional privilege.

Do not replace Supabase Auth or duplicate `staff_users`. Preserve PIN/Passkey sign-in while strengthening individual account lifecycle. Do not change financial calculations, fuel inventory, POS sales, or close-day behavior in this phase.

## Implementation sequence

1. Inventory all tRPC procedures and map read/write actions to resource permissions, branch scope and ownership. Include direct/edge API paths, desktop and mobile callers.
2. Introduce a centralized action permission policy with explicit default-deny for sensitive operations. Example permissions: `cost.read`, `profit.read`, `closing.approve`, `closing.adjust.request`, `users.manage_staff`, `audit.read`. Retain menu permissions for navigation only.
3. Apply server-side authorization to every sensitive procedure and verify branch-scoped row filters; require approval workflows for finalized financial records.
4. Tighten account lifecycle: staff invitation/provisioning, disable/revoke sessions, credential recovery, MFA/Passkey policy for privileged accounts. Review PIN brute-force defenses across distributed instances.
5. Add migration only for genuinely missing tables/columns after full schema review; use additive migrations and reversible rollout. Do not run `db:push` against production.
6. Update login and user management UI across web/desktop/mobile after API contracts stabilize.
7. Add negative authorization tests: unauthenticated, suspended, role escalation, IDOR, cross-branch, staff reading cost/profit, staff approving closings, session revocation, and local HMAC token rejected in production.
8. Validate with `npm run check`, `npm run lint`, `npm test`, `npm run build`, `npm run build:edge`, and isolated database migration tests. Use staging data, never production credentials.
9. Open review PR; require review, successful CI, backup/restore test, and explicit approval before merging or deploying.

## Security invariants

- Authorize actions on the server, not by hiding UI menus.
- Derive actor identity from verified Supabase session, never request body.
- Never expose Supabase secret/service role keys to browsers.
- No hard deletion of financial audit history; adjustments must be append-only and attributable.
- Never log PINs, passwords, access/refresh tokens, or passkey secrets.
- Business Owner is not automatically platform administrator.
- Public repository: secrets and personal data must remain outside tracked files.

## First code change checklist

- [ ] Review `web/contracts/menuPermissions.ts` and enumerate API paths with no required menu.
- [ ] Review `web/api/routers/auth.ts` account creation/role changes and privilege boundaries.
- [ ] Review `web/api/routers/staffAuth.ts` PIN and Passkey flows.
- [ ] Review `web/api/lib/authorization.ts` cache and deactivation behavior.
- [ ] Review `web/db/schema.ts` before proposing SQL migration.
- [ ] Add explicit action authorization and tests in a separate commit.
- [ ] Keep production untouched until approval.

# KY-FuelPOS — Codex Development Handoff (RBAC v2)

**Date:** 2026-11-22  
**Repository:** `weerayut6046/Kimi-Agent-POS`  
**Working branch:** `feature/role-based-access-v2`  
**Review PR:** https://github.com/weerayut6046/Kimi-Agent-POS/pull/40 (draft)  
**Status:** Partial implementation; NOT production-ready.

> Codex: Read `AGENTS.md` first. Work ONLY on the feature branch. Never merge into `main`, deploy, connect to production databases, rotate production credentials, or run production migrations without explicit approval. Do not assume tests have passed.

## 1. Mission

Finish **individual staff accounts and secure role/action-based authorization** for the existing KY-FuelPOS fuel station management system.

Roles in business UI:
- Owner — financial oversight, staff administration, sensitive approvals.
- Manager — operational oversight, close-day approval and staff management within delegated scope; no cost/profit access by default.
- Staff — shift-level operations, meter readings and submission; no financial profit/cost access or closing approval.

**Backward compatibility:** persisted roles are `admin`, `manager`, `cashier` respectively. Do not rename persisted role values without an explicit migration plan. Platform administrator privileges and station Owner privileges must be distinguished: do not automatically grant platform-wide access to a business Owner.

## 2. Verified repository architecture

- Frontend: React + Vite + TypeScript; Electron desktop wrapper; Flutter mobile client.
- API: tRPC/Hono in `web/api/`; Supabase Edge functions in `supabase/functions/`.
- Database: PostgreSQL, Drizzle ORM; application tables in `pos` schema.
- Authentication: Supabase Auth, per-staff PIN and Passkey, plus development/test-only legacy HMAC session compatibility.
- Existing data structures: `staffUsers`, `staffBranches`, `staffAccessGroups`, `loginAttempts`, passkey credentials/challenges.
- Existing navigation permissions: `web/contracts/menuPermissions.ts`.
- Existing authentication and authorization: `web/api/routers/auth.ts`, `web/api/routers/staffAuth.ts`, `web/api/lib/authorization.ts`, `web/api/lib/session.ts`, `web/api/middleware.ts`, `web/api/guard.ts`.
- Existing schema: `web/db/schema.ts` and `supabase/migrations/`.

Read `docs/role-based-access-v2-plan.md` and `AGENTS.md` for project-specific requirements.

## 3. Already committed on this branch

- `web/api/lib/businessPermissions.ts`: first-pass action catalog, role-to-action matrix, default-deny unknown roles/actions, UI role labels.
- `web/api/lib/businessPermissions.test.ts`: initial unit tests for policy matrix.
- `web/api/guard.ts`: reusable `businessActionQuery(action)` tRPC guard.
- `docs/role-based-access-v2-plan.md`: initial planning document.

**Important:** The new guard is not yet wired to every sensitive business procedure. Tests have NOT been executed or verified by the previous assistant. Do not claim the feature is finished.

## 4. Non-negotiable constraints

1. Keep the current Supabase Auth identity model; do not create a duplicate user/authentication system.
2. Preserve existing PIN and Passkey compatibility, subject to security hardening.
3. Respect `AGENTS.md`: register and map menu permissions centrally, wire frontend route and API permission mappings, update automated tests. Action-level authorization supplements, never replaces, menu permission enforcement.
4. Enforce permissions **server-side** on every relevant procedure, including read-only data paths and Edge API paths. UI visibility alone is not authorization.
5. Scope reads/writes by authenticated staff identity, station/branch membership, ownership, record status and separation of duties. Never trust client-provided actor or branch identifiers without validation.
6. No changes to fuel sales totals, oil product accounting, cost/profit formulas, inventory calculations, closing arithmetic or existing POS integration in this task. Avoid double-counting POS-recorded product sales.
7. Financial closing adjustments must preserve an immutable audit trail. Do not directly overwrite finalized records without an approved adjustment workflow.
8. No secrets, personal data, PINs, passwords or session tokens in Git commits, logs or PR comments.
9. Do not run `db:push` or migrations against production. Add migrations only if existing schema cannot support the required behavior.
10. No merging/deployment to production; maintain a reviewable draft PR.

## 5. Ordered implementation tasks

### Task A — Inventory authorization coverage (do first)
- Enumerate tRPC routers/procedures, Edge endpoints and privileged actions.
- Produce a table of endpoint, current guard, required menu key, required business action, branch scope, owner/record-state checks and test status.
- Investigate procedures where `getApiMenuPermissions(path)` returns no menu requirement; distinguish intentionally public auth endpoints from accidental gaps.
- Audit `adminQuery`, `managerQuery`, `publicQuery`, `authenticatedStaffAction` and all direct API entrypoints.
- Inspect `getDeploymentMode() === "platform"` rules to avoid confusing platform admin and business Owner.

**Deliverable:** `docs/rbac-v2-api-audit.md` with prioritized findings and evidence.

### Task B — Harden action-level authorization
- Review the provisional `BUSINESS_ACTIONS` matrix with existing business rules before broad adoption.
- Apply `businessActionQuery` or a more appropriate reusable guard to sensitive tRPC procedures; ensure existing menu checks still execute.
- Add resource-level predicates for branch, staff ownership and record state; ensure queries filter unauthorized rows, not merely UI components.
- Ensure Managers cannot create/promote Owner accounts, elevate themselves or alter another Manager without explicit owner authorization.
- Ensure Staff cannot read cost/profit or approve/reopen a finalized closing.
- Keep business Owner and platform administrator separated.

**Deliverable:** minimal, reviewable implementation commits with negative authorization tests.

### Task C — Individual account lifecycle
- Verify that each staff member has a distinct `staff_users` row and Supabase Auth identity.
- Review create/invite, reset, suspend, reinstate, delete and role-change flows in `auth.ts`.
- Validate session revocation/deactivation latency, including caches and existing tokens.
- Check distributed rate-limiting for short PINs and Passkey challenges; do not rely solely on process-local Maps when multiple server instances are possible.
- Determine MFA/Passkey enrollment policy for Owner/Manager; document any Supabase capability/configuration dependencies.
- Keep legacy account migration safe and avoid exposing credential material.

### Task D — UI integration
- Web login: accessible, responsive, Thai-first, clear errors that do not reveal account existence.
- User administration: owner-managed accounts, constrained manager staff-management, account status, role, branch and credential reset flows.
- Sidebar/dashboard: show only relevant menus; retain backend enforcement.
- Verify desktop and Flutter compatibility before changing shared auth response contracts.
- Reuse existing design components and do not redesign unrelated financial pages.

### Task E — Database and audit
- Review existing tables and migrations before introducing `action_permissions`, approvals, security events or session revocation records.
- Prefer code-defined permission matrix where sufficient; avoid redundant tables.
- Any additive SQL migration needs rollback/forward plan, constraints/indexes, RLS/grant review and isolated migration tests.
- Do not store raw credentials or secrets.
- Financial audit entries should identify actor, action, target, timestamp, reason and appropriate before/after metadata without leaking secrets.

### Task F — Tests and verification
At minimum, add tests for:
- anonymous/expired/suspended session denial;
- Staff denied `cost.read`, `profit.read`, `closing.approve`;
- Manager denied cost/profit and Owner promotion;
- role self-escalation and cross-branch access;
- IDOR and ownership checks on staff records, shifts and meter readings;
- finalized closing cannot be silently modified;
- legacy HMAC session rejected in production;
- PIN brute-force and Passkey failure behavior;
- no regression to existing menu permissions and current login flows.

Run in a non-production environment:
```bash
npm ci
npm run check
npm run lint
npm test
npm run build
npm run build:edge
```
If a command fails, capture the exact failure and distinguish pre-existing failures from changes in this branch. Never claim passing tests without execution.

## 6. Acceptance criteria / Definition of Done

- [ ] All sensitive procedures have documented server-side permission coverage.
- [ ] Role + action + branch + ownership + record state are enforced where applicable.
- [ ] Existing PIN/Passkey and Supabase Auth flows remain compatible.
- [ ] Owner, Manager and Staff see correct UI and cannot bypass it via direct API calls.
- [ ] Negative authorization tests are committed and passing.
- [ ] No unreviewed changes to financial calculation or POS sales flows.
- [ ] No production migration, merge or deployment.
- [ ] Draft PR contains change summary, test output, security risks and rollout/rollback plan.

## 7. Reporting format for Codex

After each task, report:
1. Files changed and why.
2. Authorization/security behavior added.
3. Tests executed and exact results.
4. Remaining risks, blockers or decisions requiring owner approval.
5. Commit SHA and PR link.

Prefer small commits and incremental verification. Stop and ask before any destructive change or change affecting production.

## 8. Copy/paste starter instruction for Codex

> Read `AGENTS.md`, `docs/role-based-access-v2-plan.md`, and `docs/CODEX_RBAC_V2_HANDOFF.md`. Continue work on `feature/role-based-access-v2` only. Start with Task A: audit all tRPC/Edge API authorization coverage and create `docs/rbac-v2-api-audit.md`. Then implement Task B in small commits, with negative tests, preserving existing Supabase Auth/PIN/Passkey and business calculations. Do not touch production, merge to main, or deploy. Run relevant tests and report exact results and commit SHAs.

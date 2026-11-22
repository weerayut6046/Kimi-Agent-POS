# KY-FuelPOS RBAC v2 API authorization audit

This inventory records the behavior at branch commit `f73346ec81eb2bd42df5575e65ad294804d1c04a`, before Task B. It covers the Node tRPC router, its Supabase Edge counterpart, direct HTTP endpoints and client entry points. Existing tests in the tables are source references. The verification section records the checks executed for this audit.

## Findings by priority

| Priority | Finding | Evidence and Task B boundary |
| --- | --- | --- |
| High | Cost and profit can be read outside the intended role matrix. | The five `fuelCosting.*` procedures use the Manager role guard, and operational catalog, tank refill, shift and dashboard responses include cost fields. Gate the financial API and project operational results before returning them. Preserve acquisition inputs, retail totals and cost calculations. |
| High | Staff can submit or verify another employee's active shift where the shift gate permits scheduled coworkers. | `pos.closeShift` and `pos.shiftMeterVerify` check branch and open status but lack a staff-ID predicate. Preserve Staff submission of their own shift and protect supervisor close separately. Lock the row for the close transaction. |
| High | Finalized closing history can be overwritten or deleted. | The historical edit and delete procedures rewrite readings or unlink financial records. Freeze these operations on finalized history. The schema currently models open and closed shifts. A separate adjustment and approval workflow needs its own review. |
| High | Delegated staff management and Owner continuity lack complete resource checks. | Staff administration is Owner-only at baseline. Delegation to Manager needs role, menu, branch and target checks in the account handlers. Last active Owner protection must cover deactivation, demotion and concurrent writes. |
| High | Payment session and card batch identifiers need narrower scope. | Payment sessions are branch scoped but lack operator ownership and accept a supplied sale shift. Loyalty card batch list/detail omit the branch predicate. Keep the existing branch-level POS workflow and business-wide membership identity. |
| Medium | Shared reads and direct endpoints disclose more information than their clients need. | `catalog.getSettings` returns arbitrary branch settings, roster responses include account metadata, and LAN/SSE/loyalty have distinct access rules. Limit shared projections and validate permissions at the entry point. |
| Medium | Session, Edge and offline boundaries need independent verification. | JWT identity resolution, branch selection, deployment isolation and cached data have different lifetimes. Exercise real tRPC middleware against an isolated database. Confirm Edge bundle parity and document deployed infrastructure checks separately. |

The menu registry defines eligible navigation and API modules. The action policy adds role checks to sensitive business operations. Each relevant handler must still constrain its target row by the verified branch, actor and record state. In a platform deployment, the dedicated database and explicit procedure allowlist apply before role checks.

## Authentication and account administration

The inventory below covers all 20 procedures registered by [auth.ts](../web/api/routers/auth.ts) and six registered by [staffAuth.ts](../web/api/routers/staffAuth.ts). Test names denote existing source coverage. A gap indicates that no direct case was identified. See the verification section for executed results.

| Procedure | Current guard | Current menu | Required policy | Branch scope | Actor or state check | Existing tests or gap |
| --- | --- | --- | --- | --- | --- | --- |
| `auth.deploymentInfo` | `anonymousQuery` | None | Public deployment discovery | Deployment | Reports configured mode only | `deployment-boundaries.test.ts` |
| `auth.reportLoginAttempt` | `anonymousQuery`; optional verified actor | None | Public login telemetry | Current session branch, otherwise main | Success requires matching verified username; rate limit per IP and username in current process | `security.test.ts` |
| `auth.realtimeSession` | `authenticatedStaffAction` | None | Authenticated compatibility no-op | Session branch validation | Returns null | `auth.menu-permissions.test.ts` |
| `auth.currentStaff` | `authenticatedStaffAction` | None | Authenticated self | Session branch, authorized branch list | Reloads active actor by verified staff ID | `auth.menu-permissions.test.ts`, `auth.branch-access.test.ts` |
| `auth.systemAccess` | `authenticatedStaffAction` | None | Authenticated self | Session branch | Checks active shift, shift ownership or own schedule; Owner and Manager exempt | System access and deployment tests |
| `auth.switchBranch` | `authenticatedStaffAction` plus inline admin check | None | Owner branch switch | Requested active branch in this business | Reloads active actor by verified staff ID | `auth.branch-access.test.ts` |
| `auth.listBranches` | `publicQuery` | None | Authenticated branch discovery in shell | Owner all active branches; others only working branch | Active branch only | `auth.branch-access.test.ts` |
| `auth.listAllBranches` | `adminQuery` | None | Owner branch administration | All branches in this business | Includes inactive branches | `deployment-boundaries.test.ts` |
| `auth.createBranch` | `adminQuery` | None | Owner branch administration | May clone verified current branch setup | Unique branch code; transactional creation | `auth.branch-access.test.ts`, `branch-isolation.test.ts` |
| `auth.updateBranch` | `adminQuery` | None | Owner branch administration | Any branch in this business | Target must exist; cannot deactivate own current branch | Gap for direct update denial |
| `auth.listStaff` | `publicQuery` | None | Branch roster for shift/workforce consumers, constrained response | Membership in current branch | No target role or active filter; removes PIN, stored menus and Supabase identity from output, while spread includes passkey user handle and access-group ID | Mapping test in `menuPermissions.test.ts`; direct data minimization gap |
| `auth.listStaffAccess` | `adminQuery` | None | `users.manage_staff` for delegated Staff visibility; Owner can view all | All current business branches | Returns configuration and memberships; removes PIN and Supabase identity | `auth.menu-permissions.test.ts` denies non-admin; delegated scope gap |
| `auth.listAccessGroups` | `adminQuery` | None | Owner permission administration | Business-wide | Includes member counts | `auth.menu-permissions.test.ts` |
| `auth.permissionCatalog` | `adminQuery` | None | Owner permission administration | Shared registry | Catalog contains menu keys and role eligibility | `auth.menu-permissions.test.ts` |
| `auth.createAccessGroup` | `adminQuery` | None | Owner permission administration | Business-wide | Group limited to Manager/Staff; menu role ceiling and unique name | `auth.menu-permissions.test.ts` |
| `auth.updateAccessGroup` | `adminQuery` | None | Owner permission administration | Business-wide | Existing group, immutable group role, valid menu ceiling | `auth.menu-permissions.test.ts` |
| `auth.deleteAccessGroup` | `adminQuery` | None | Owner permission administration | Business-wide | Existing group; foreign key clears assignment | `auth.menu-permissions.test.ts` |
| `auth.createStaff` | `adminQuery` | None | `users.manage_staff` with Manager restricted to Staff in own working branch | Validates active requested branches and optional expected active branch | Unique username, matching access-group role, PIN uniqueness and one Supabase identity per account in production | `auth.branch-access.test.ts`, `auth.staff-pin.test.ts`; Manager delegation gap |
| `auth.updateStaff` | `adminQuery` | None | `users.manage_staff` with Manager restricted to Staff in own working branch | Validates active new branches; Owner may edit any branch | Existing target, group role check and PIN checks; does not prevent demotion or disabling of the last active Owner | `auth.menu-permissions.test.ts`, `auth.staff-pin.test.ts`; last Owner and concurrent target change gaps |
| `auth.deleteStaff` | `adminQuery` | None | Owner-only permanent removal; Managers may use delegated suspension | Any branch in this business | No self-deletion, at least one active admin and payroll history protected | `auth.delete-staff.test.ts` |
| `staffAuth.passkeyStatus` | `anonymousQuery` | None | Public sign-in discovery | Configured origin | Returns capability only | `staffAuth.passkey.test.ts` |
| `staffAuth.beginPasskeyRegistration` | `publicQuery` | `settings` | Own active account with settings permission | Session branch validation | Actor-bound challenge and opaque user handle; checks current credential count | `staffAuth.passkey.test.ts` |
| `staffAuth.completePasskeyRegistration` | `publicQuery` | `settings` | Own active account with settings permission | Session branch validation | Challenge is bound to actor, purpose, expiry and unconsumed state; origin/RP/verification checked; credential ID unique | `staffAuth.passkey.test.ts` |
| `staffAuth.beginPasskeyLogin` | `anonymousQuery` | None | Public challenge initiation | Configured origin | Database and in-process IP limits; issued challenge expires | `staffAuth.passkey.test.ts` |
| `staffAuth.completePasskeyLogin` | `anonymousQuery` | None | Credential verification | Chooses active assigned working branch | One-time authentication challenge, active staff, credential association, signature/origin/RP/user verification and counter check | `staffAuth.passkey.test.ts` |
| `staffAuth.loginWithPin` | `anonymousQuery` | None | Credential verification | Default working branch and branch membership | Active account, PIN, database IP attempt limit and production Supabase identity | `staffAuth.test.ts` |

### Shared authorization and identity findings

- **High — account-authority scope.** [auth.ts](../web/api/routers/auth.ts) currently protects account mutations with `adminQuery`. The provisional policy already delegates `users.manage_staff` to Manager. Apply it alongside server-side menu permission and constrain delegation to Staff exclusively assigned to the Manager's verified working branch. Keep access groups, elevated roles, permission assignments and permanent deletion under Owner control. Where a target is read and then written, keep the role and membership checks consistent through the write. The existing single-working-branch behavior for non-Owners is deliberate and covered by [auth.branch-access.test.ts](../web/api/routers/auth.branch-access.test.ts).
- **High — retaining an active Owner.** `auth.updateStaff` validates branch assignments and group role but does not guard last-Owner deactivation or demotion. `auth.deleteStaff` checks the active-Owner count outside a transaction. Owner-state enforcement needs to cover both mutation paths and serialize concurrent removals of Owner authority.
- **Medium — account data on a shared read.** `auth.listStaff` serves shift and settings clients as well as Flutter operation sheets. Its branch filter is intentional. Use an explicit safe response projection and tie the procedure to menus of the actual consuming modules. `auth.listStaffAccess` should scope delegated account administration independently of this operational roster.
- **Medium — session invalidation window.** [authorization.ts](../web/api/lib/authorization.ts) validates the Supabase JWT, requires a session ID claim and derives the actor from the unique database identity, then caches the active account, role and branch for five seconds per isolate. [middleware.ts](../web/api/middleware.ts) clears the current isolate on successful auth mutations. External updates, other isolates and overlapping in-flight requests can retain that snapshot until expiry. The JWT claims check does not query a live Supabase session record. Review global revocation, partial Supabase-provider failures and rate-limit concurrency in Task C.
- **Medium — shared menu behavior.** [middleware.ts](../web/api/middleware.ts) shows that `publicQuery` requires an active authenticated staff session, optionally checks the menu and always checks the active shift rule. `adminQuery`, `managerQuery` and `businessActionQuery` extend it. Empty menu mappings therefore fall back to the procedure and shift guards. `authenticatedStaffAction` intentionally bypasses shift gating for session and access-status APIs. [systemAccess.ts](../web/api/lib/systemAccess.ts) falls back to matching a staff name only for legacy open shifts lacking a staff ID. Use verified actor IDs for new ownership checks.
- **Medium — platform isolation.** [deployment.ts](../web/api/lib/deployment.ts) derives the mode from server configuration. The [deployment contract](../web/contracts/deployment.ts) denies `platform.*` in business deployments and permits only platform procedures and an explicit auth/bootstrap list in platform deployments. `authenticatedStaffAction` separately rejects non-admin platform identities. The same persisted `admin` value represents a local Owner in an isolated business database and a platform administrator only in the dedicated platform deployment. Business action guards must preserve the deployment check. [deployment-boundaries.test.ts](../web/api/routers/deployment-boundaries.test.ts) covers the existing separation.
- **Follow-up — account and credential lifecycle.** [schema.ts](../web/db/schema.ts) already provides unique username, Supabase user ID and passkey handle constraints, memberships and access groups. PIN and Passkey login already issue the existing session shape. PIN and Passkey challenge limits consult the database but check and insert are separate operations. `auth.reportLoginAttempt` accepts unauthenticated failure reports and uses the same attempt table as the PIN limiter, so its log/limiter interaction merits lifecycle review. [session.ts](../web/api/lib/session.ts) limits HMAC compatibility to local development and tests. Exercise production rejection directly in automated tests.
## Business and platform tRPC procedures

Inventory at feature-branch SHA `f73346ec81eb2bd42df5575e65ad294804d1c04a`. Node and Edge use the same procedure registrations. The two `dbadmin` imports both re-export `dbadmin.file.ts`. Procedure names below are relative to the module in each section. Q denotes query, M mutation. P is `publicQuery`, which requires an active staff session, enforces any mapped menu, and runs the system-access check. A and G add the Owner or Owner/Manager role ceiling to P, respectively. S is `authenticatedStaffAction`, which requires an active staff session and the deployment boundary. N is `anonymousQuery`, which enforces the deployment boundary. Menu alternatives are OR conditions. Branch means the session's active, authorized branch unless otherwise stated.

The action column describes the required business authorization. Existing action identifiers are in code format. Other entries describe the operation protected by the existing guards or a candidate explicit action. Tests listed under each section are existing suites, reviewed as source coverage. They do not imply a test result or coverage for every procedure.

### POS ([pos.ts](../web/api/routers/pos.ts))

| Procedure | Method/guard | Menu | Business action | Branch and ownership/state |
| --- | --- | --- | --- | --- |
| currentShift | Q/P | none (app shell) | Read current operational shift; `cost.read` for restricted fields | Branch open shift and readings, raw cost snapshot and product cost, no own filter |
| shiftMeterVerify | M/P | shifts | `meter.create` | Branch open shift and per-actor limit, no own filter |
| openShift | M/P | shifts | `shift.submit` | Branch/nozzles verified; one open shift check; owner from session; response includes raw costs |
| closeShift | M/P | shifts | `shift.submit` for Staff's own operational shift; `closing.approve` for separate approval | Branch open state checked before transaction, no owner check or transaction-time open predicate |
| shiftHistory | Q/P | shifts | Read operational shift history | Branch/date range, no own filter |
| searchShiftHistory | Q/A | shifts | Administrative shift history read | Branch and filters |
| createShiftHistory | M/A | shifts | `closing.approve` with historical-entry controls | Branch and nozzle/reading validation; creates as closed |
| updateShiftHistory | M/A | shifts | `closing.adjust.request` with append-only approval workflow | Branch and closed state checked; overwrites closed record and readings directly |
| deleteShiftHistory | M/A | shifts | Preserve finalized history | Branch and closed state checked; removes shift/readings and unlinks related financial records |
| shiftDetail | Q/P | shifts | Read shift detail; `cost.read` for restricted fields | Branch shift/readings and linked sales, no own filter; raw cost snapshot and product cost |
| createSale | M/P | pos | Create operational sale | Branch open shift, actor from session, branch-scoped receipt replay and product checks |
| salesHistory | Q/P | sales | Branch sales lookup | Branch sales and member filters; business-wide member master |
| saleDetail | Q/P | sales | Branch sales lookup | Branch sale and child items; receipt projection omits unit cost |
| returnSale | M/G | sales | Initiate approved sale reversal | Branch original sale and lines with locks, validates returned quantities and uses separate return record |
| voidSale | M/A | sales | Administrative sale reversal | Branch sale lock and completed/return checks, updates status; check finalized shift linkage |
| updateSale | M/G | sales | Approve sale adjustment | Branch sale with transaction revalidation; check finalized shift linkage |
| deleteSale | M/G | sales | Preserve sales history | Branch checks, hard-deletes sale/items/invoice; check finalized shift linkage |
| dashboard | Q/P | dashboard | Operational summary; `cost.read` for restricted fields | Branch summaries; full low-stock product rows contain cost |

Existing tests include `pos.shift*`, `pos.sale`, `pos.dashboard`, `branch-isolation`, and `middleware.shift-permissions`. They cover opening/closing calculations, receipt and mutation role checks, history edits by Owner, and branch isolation samples. Add cost filtering, same-branch shift ownership and finalized-record tests.

### Catalog ([catalog.ts](../web/api/routers/catalog.ts))

| Procedure | Method/guard | Menu | Business action | Branch and ownership/state |
| --- | --- | --- | --- | --- |
| listProducts | Q/P | pos, stock, sales, settings | Product read; `cost.read` for restricted fields | Branch rows; only Staff cost is zeroed |
| searchExternalProduct | Q/P | pos | Operational product lookup | External barcode lookup, no local rows |
| importExternalProduct | M/P | pos | Operational product creation; separate cost write permission | Branch duplicate checks; Staff cost reset to zero, Manager cost accepted/returned |
| reorderProducts | M/A | settings | Administer product order | Branch products and setting |
| createProduct | M/A | settings | Administer product and cost | Branch product |
| updateProduct | M/A | settings | Administer product and cost | Branch target and price change history |
| deleteProduct | M/A | settings | Administer product | Branch target; existing references can block removal |
| priceHistory | Q/P | settings | Read retail price history | Branch/product; schema has retail prices only |
| adjustStock | M/A | settings | Approve stock adjustment | Branch product and nonnegative result |
| listPumps | Q/P | shifts, settings | Read infrastructure; `cost.read` for restricted fields | Branch pump/nozzle/product/tank; nested product cost returned |
| createPump | M/A | settings | Administer pump | Branch creation |
| updatePump | M/A | settings | Administer pump | Branch target |
| deletePump | M/A | settings | Administer pump | Branch target and reference checks |
| createNozzle | M/A | settings | Administer nozzle | Branch pump/product/tank verified |
| updateNozzleMeter | M/A | settings | Approve equipment/meter adjustment | Branch nozzle and linked equipment validation; checks shift state for setup edits |
| deleteNozzle | M/A | settings | Administer nozzle | Branch target and references |
| listTanks | Q/P | stock, settings | Read infrastructure; `cost.read` for restricted fields | Branch tank/product/nozzle; nested product cost returned |
| reorderTanks | M/A | settings | Administer tank order | Branch tank IDs and setting |
| lowStockAlerts | Q/P | stock | Read operational alerts | Branch and projected quantities only |
| createTank | M/A | settings | Administer tank | Branch and product verification |
| deleteTank | M/A | settings | Administer tank | Branch target and references |
| updateTank | M/A | settings | Administer tank | Branch target |
| refillTank | M/P | stock | Post refill and write procurement cost | Branch tank locked and capacity checked; sets product cost even for Staff |
| listRefills | Q/P | stock | Read refills; `cost.read` for restricted fields | Branch refill/tank scope; returns raw procurement costs |
| addTankReading | M/P | stock | `meter.create` | Branch tank and capacity checked, records session actor |
| listTankReadings | Q/P | stock | Read operational readings | Branch readings/tanks; review Staff ownership requirements |
| deleteTankReading | M/A | settings | Approve readings correction | Branch and audit, hard delete |
| getSettings | Q/P | none (shared UI) | Read shared branch settings | Branch rows, arbitrary keys passed through except logo; AI/payment secrets use separate tables |
| getShopLogo | Q/P | none (shared UI) | Read shared branch logo | Branch setting and single key |
| lanInfo | Q/N | settings mapped, bypassed | Anonymous local login discovery | Public-cloud response suppressed; local deployment setting and interface addresses |
| updateSettings | M/A | settings | Administer branch settings | Branch upsert; write input allowlist |
| updateTemplate | M/A | settings | Administer branch template | Branch upsert |
| updateTheme | M/A | settings | Administer branch theme | Branch upsert |
| updateBillPromotion | M/G | settings | Administer bill promotion | Branch settings and validated effective values |
| updatePerLiterPromotion | M/G | settings | Administer fuel promotion | Branch settings and validated effective values |

Existing tests include `catalog.alert`, `catalog.external-product`, `catalog.nozzle-tank`, `catalog.product-order`, `catalog.pump-nozzle-crud`, `catalog.refill`, `catalog.settings`, `catalog.setup-branch`, `catalog.tank-reading`, and `branch-isolation`. Add response-field and cost-write coverage for Manager and Staff.

### Fuel costing, reports, and forecasting

| Endpoint | Method/guard | Menu | Business action | Branch and ownership/state |
| --- | --- | --- | --- | --- |
| fuelCosting.unconfirmedReceipts | Q/G | fuel_costing | `cost.read` | Branch refill/tank/product; unconfirmed cost only |
| fuelCosting.confirmReceiptCost | M/G | fuel_costing | Confirm procurement cost | Branch refill/tank and atomically requires unconfirmed state |
| fuelCosting.openings | Q/G | fuel_costing | `cost.read` | Branch product and opening |
| fuelCosting.setOpening | M/G | fuel_costing | Set opening cost | Branch fuel product and unique opening |
| fuelCosting.report | Q/G | fuel_costing | `cost.read` and `profit.read` | Branch ledger inputs and bounded date range |
| reports.daily | Q/P | dashboard, sales | Operational day summary read | Branch report; no state change or independent approval |
| reports.fuelStockSummary | Q/G | stock | Read operational inventory report | Branch stock movement summary and period bounds |
| reports.tankReconciliation | Q/G | stock | Read reconciliation | Branch tank/reading/movement filters |
| reports.exportFuelStockExcel | Q/G | stock | Export operational inventory report | Branch summary and period bounds |
| reports.exportDailyExcel | Q/G | sales | Export branch day report | Branch report and date |
| reports.exportRangeExcel | Q/G | sales | Export branch period report | Branch report; maximum 92 days |
| fuelForecast.summary | Q/P | fuel_forecast | Read operational fuel forecast | Branch stock trends and settings |
| fuelForecast.saveSettings | M/G | fuel_forecast | Manage forecast policy | Branch target tank and upsert |

Existing tests include `fuelCosting`, `fuelForecast`, `reports`, `reports.fuel-stock`, and `reports.tank-reconciliation`. Baseline costing tests explicitly allow Manager access. Reports use sales and stock quantities without cost/profit fields. Daily report is a read and does not finalize a close-day record.

### Workforce, inventory count, and expenses

| Endpoint | Method/guard | Menu | Business action | Branch and ownership/state |
| --- | --- | --- | --- | --- |
| workforce.listTemplates | Q/P | workforce | Read branch schedule definitions | Branch templates |
| workforce.upsertTemplate | M/A | workforce | Manage schedule definitions | Branch template ID or new branch template |
| workforce.deleteTemplate | M/A | workforce | Manage schedule definitions | Branch template, reference check |
| workforce.directory | Q/A | workforce | Read branch staff directory | Branch membership |
| workforce.scheduleList | Q/P | workforce | Read schedules | Branch; Staff forced to actor ID |
| workforce.myScheduleList | Q/P | workforce | Read own schedules | Branch plus actor ID |
| workforce.createSchedule | M/A | workforce | Manage schedules | Branch member and template; duplicate checks |
| workforce.updateSchedule | M/A | workforce | Manage schedules | Branch schedule/member/template and duplicate checks |
| workforce.updateCashAdvance | M/G | workforce | Manage wage advance | Branch schedule target; actor audit; review peer/Owner targeting |
| workforce.deleteSchedule | M/A | workforce | Manage schedules | Branch schedule target and audit |
| workforce.swapSchedules | M/A | workforce | Manage schedules | Both records in branch, membership and conflict checks |
| workforce.employeeProfiles | Q/A | workforce | Read branch employee profiles | Branch membership join |
| workforce.myProfile | Q/P | workforce | Read own employee profile | Actor ID |
| workforce.upsertEmployeeProfile | M/A | workforce | Administer employee profile | Branch membership |
| workforce.payrollList | Q/A | workforce | Read branch payroll | Branch and month |
| workforce.myPayroll | Q/P | workforce | Read own payroll | Branch plus actor ID and month |
| workforce.generatePayroll | M/A | workforce | Generate branch payroll | Branch active staff/schedules and target month; skips existing paid records |
| workforce.updatePayroll | M/A | workforce | Manage branch payroll | Branch record; blocks paid changes |
| workforce.setPayrollStatus | M/A | workforce | Approve payroll state change | Branch record; status may change between draft and paid |
| stockCount.listSessions | Q/P | stock | Read count sessions | Branch sessions and child items |
| stockCount.getSession | Q/P | stock | Read count session | Branch session and child items |
| stockCount.createSession | M/G | stock | Start count session | Branch one-current-count check and active products |
| stockCount.saveItemCount | M/P | stock | Submit item count | Branch session locked and counting; item belongs to session; actor recorded |
| stockCount.completeSession | M/G | stock | Approve inventory count | Branch session locked and counting; all items counted; branch product predicates |
| stockCount.cancelSession | M/G | stock | Cancel inventory count | Branch session locked and counting |
| expenses.list | Q/P | expenses | Read operating expenses | Branch and date filters |
| expenses.create | M/P | expenses | Submit operating expense | Branch; associates active branch shift if any |
| expenses.update | M/G | expenses | Approve expense correction | Branch target, no finalized shift check; audit |
| expenses.remove | M/G | expenses | Approve expense reversal | Branch target, hard delete, no finalized shift check; audit |

Existing suites `workforce`, `stockCount`, `expenses`, and `branch-isolation` have role, ownership, branch or record-state samples. Assess the historical expense adjustment policy alongside finalized closing protection.

### Customer and loyalty

| Endpoint | Method/guard | Menu | Business action | Branch and ownership/state |
| --- | --- | --- | --- | --- |
| customers.list | Q/P | customers | Read customer directory | Business-wide customer master has no branch column |
| customers.lookupTaxpayer | Q/P | customers | Read tax registration data | External lookup, no internal row scope |
| customers.create | M/G | customers | Manage customer directory | Business-wide master, tax number uniqueness |
| customers.update | M/G | customers | Manage customer directory | Business-wide master by ID, tax number uniqueness |
| customers.remove | M/G | customers | Manage customer directory | Business-wide master by ID; checks outstanding across branches |
| credit.summary | Q/P | debts | Read credit summary | Business-wide customer master, branch-scoped outstanding |
| credit.detail | Q/P | debts | Read credit details | Business-wide customer identity; branch sales/payments |
| credit.receivePayment | M/G | debts | Receive branch debt payment | Branch outstanding and active shift; payment staff label accepted from client |
| credit.removePayment | M/G | debts | Reverse branch debt payment | Branch target; hard delete and no finalized shift check |
| taxInvoice.bySale | Q/P | tax_invoices | Read invoice | Branch invoice and sale ID |
| taxInvoice.list | Q/P | tax_invoices | Read invoice list | Branch invoice and sale join |
| taxInvoice.salesAvailable | Q/P | tax_invoices | Read eligible sales | Branch completed sale and absent invoice |
| taxInvoice.remove | M/A | tax_invoices | Administer invoices | Branch target and hard delete |
| taxInvoice.save | M/P | tax_invoices | Issue or update invoice | Branch completed non-return sale; existing invoice update; issue label accepted from client |
| membership.customerPoints | Q/N | members mapped, bypassed | Public loyalty self-service | Phone lookup, masked identity and rate limit; business-wide ledger history, no verified phone ownership |
| membership.listCardBatches | Q/G | members | Read issuance batches | Batch has branch ID but no branch predicate |
| membership.getCardBatch | Q/G | members | Read issuance batch and cards | Batch by ID without branch predicate |
| membership.createCardBatch | M/G | members | Issue branch card batch | Branch batch with distinct card code checks |
| membership.listMembers | Q/P | members | Read member directory | Business-wide member master; branch attribution for expiry job |
| membership.findByPhone | Q/P | members | Read member directory | Business-wide member master lookup |
| membership.checkCardAvailability | Q/P | members | Validate member card | Business-wide card code and activation state |
| membership.createMember | M/P | members | Register member | Business-wide master, unique phone/available card checks |
| membership.updateMember | M/A | members | Manage member directory | Business-wide target ID |
| membership.deleteMember | M/A | members | Manage member directory | Business-wide target ID |
| membership.adjustPoints | M/A | members | Approve loyalty adjustment | Member row locked and nonnegative balance; records branch |
| membership.memberTransactions | Q/P | members | Read loyalty ledger | Member ID without branch filter despite branch-tagged ledger; verify portability requirement |
| membership.listRewards | Q/P | members | Read branch rewards | Branch rows |
| membership.upsertReward | M/A | members | Administer rewards | Branch target or branch insert |
| membership.deleteReward | M/A | members | Administer rewards | Branch target |
| membership.redeemReward | M/P | members | Redeem reward | Business-wide member and branch reward locked; balance, stock and expiry checks |
| membership.redemptionHistory | Q/P | members | Read branch redemption history | Branch redemption/reward rows |

Existing suites include `credit`, `membership`, `branch-isolation` and customer lookup helper tests. No dedicated customers/taxInvoice router suite located. Member and business-customer master records intentionally have business scope in the current schema. Any change to that product policy needs data ownership and compatibility design.

### Payment sessions ([payments.ts](../web/api/routers/payments.ts))

| Procedure | Method/guard | Menu | Business action | Branch and ownership/state |
| --- | --- | --- | --- | --- |
| config | Q/A | pos, sales, settings | Read payment configuration | Branch settings; privileged webhook URL |
| updateConfig | M/A | pos, sales, settings | Administer payment configuration | Branch settings, encrypted secrets |
| validateMerchantQr | M/A | pos, sales, settings | Validate merchant QR | Parses supplied payload |
| testConnection | M/A | pos, sales, settings | Test payment connector | Branch runtime configuration |
| thungngernStatus | Q/P | pos, sales, settings | Check payment availability | Branch summary |
| promptpayQr | Q/P | pos, sales, settings | Generate checkout QR | Branch configuration |
| startThungngern | M/P | pos, sales, settings | Start checkout | Branch config and branch product snapshot; no staff-owner predicate |
| sessionStatus | Q/P | pos, sales, settings | Read checkout status | Branch session/ref; expires pending session conditionally |
| verifySlip | M/P | pos, sales, settings | Verify checkout and record payment | Branch config/session and payment-service state/idempotency checks |
| manualConfirm | M/P | pos, sales, settings | Confirm configured manual checkout | Branch service scope and configuration gate; review actor ownership policy |
| cancelSession | M/P | pos, sales, settings | Cancel checkout | Branch pending state; no staff-owner predicate |

Existing suites include `payments.promptpayQr` and payments service tests. Payment actions share three menus, so selecting which menus can grant mutations merits explicit review. Payment sessions do not carry an independent staff owner column.

### Administration, setup, and assistant

| Endpoint | Method/guard | Menu | Business action | Branch and ownership/state |
| --- | --- | --- | --- | --- |
| ping | Q/N | none | Anonymous health probe | Returns health and server time only |
| audit.formulaAudit | Q/A | audit | `audit.read` | Branch formula sample and limit |
| audit.analyzeFormulaAudit | Q/A | audit | `audit.read` | Branch data and branch assistant configuration |
| audit.createFormulaAuditFixPlan | M/A | audit | Manage remediation plan | Branch formula scan and attributable plan creation |
| audit.approveFormulaAuditFixPlan | M/A | audit | Approve remediation plan | Branch plan and state checks in remediation service |
| audit.createFormulaAuditRemediationWorkOrder | M/A | audit | Issue remediation work order | Branch source plan/state |
| audit.startFormulaAuditRemediationWorkOrder | M/A | audit | Start approved remediation | Branch work order/state |
| audit.verifyFormulaAuditRemediationWorkOrder | M/A | audit | Verify remediation | Branch work order/state |
| audit.list | Q/A | audit | `audit.read` | Branch log predicates |
| security.overview | Q/A | security | Inspect security summary | Branch events/reports |
| security.events | Q/A | security | Inspect security events | Branch/filter predicates |
| security.scan | M/A | security | Run security scan | Branch context |
| security.analyze | M/A | security | Analyze security history | Branch context and attributable report |
| security.reports | Q/A | security | Read security reports | Branch rows |
| security.setEventStatus | M/A | security | Manage security event state | Branch event ID and validated status |
| dbadmin.dbInfo | Q/A | settings | Inspect backup capabilities | Business database metadata only |
| dbadmin.backup | M/A | settings | Export business database | Business-wide tables; audit, no Auth users or Storage objects |
| dbadmin.restoreUpload | M/A | settings | Restore business database | Business-wide; bounded file, parser checks, explicit confirmation and audit |
| assistant.config | Q/A | none | Read assistant configuration | Branch configuration, secret status only |
| assistant.updateConfig | M/A | none | Administer assistant configuration | Branch configuration and encrypted secret handling |
| assistant.executeAction | M/S | none | Confirm and run registered action | Per-action role/menu, proposal owner/branch/status/PIN, dispatches guarded tRPC |
| assistant.chat | M/S | none | Use only permitted tools | Per-tool role/menu, branch scope, quota; lacks P's system-access check |
| onboarding.state | Q/A | setup | Read branch setup | Branch setup state |
| onboarding.saveProfile | M/A | setup | Manage branch profile | Expected branch checked against session |
| onboarding.savePayments | M/A | setup | Manage branch payments | Expected branch checked; delegates payment settings |
| onboarding.saveSystemSettings | M/A | setup | Manage branch setup settings | Expected branch checked |
| onboarding.confirmStep | M/A | setup | Confirm setup progress | Expected branch and step controls |
| onboarding.complete | M/A | setup | Complete branch setup | Expected branch and prerequisite checks |
| onboarding.createFuelSetup | M/A | setup | Administer initial equipment | Branch target, guards open shift and setup references |
| onboarding.updateEquipment | M/A | setup | Administer equipment | Branch target and open-shift guard |
| initialSetup.state | Q/N | setup mapped, bypassed | Anonymous bootstrap state | Platform reports disabled state, business reports initial setup state |
| initialSetup.createOwner | M/N | setup mapped, bypassed | Claim pristine business installation | Business-only, configured installation protection, initialization state and serialization |
| platform.overview | Q/A | platform | Platform administration | Platform-only, dedicated platform database |
| platform.listBusinesses | Q/A | platform | Platform administration | Platform-only directory and filters |
| platform.createBusiness | M/A | platform | Platform administration | Platform-only registry; validates project reference/URL; no remote provisioning |
| platform.updateBusiness | M/A | platform | Platform administration | Platform-only registry row by ID and validated changes |

Existing suites include `audit`, `audit.formula`, `security`, `dbadmin`, `assistant`, `onboarding`, `initialSetup`, `platform`, `deployment-boundaries`, and `router.edge`. Deployment mode comes from server environment and is checked before authentication. The platform explicitly allows its authentication/bootstrap endpoints and `platform.*`, requires an admin session for authenticated routes, and has a separate database and Supabase project. Business owners cannot call `platform.*` on their business deployment.

### Prioritized findings from business tRPC

1. **P1: Nested cost response exposure.** Fuel costing is Manager-accessible. Nested operational responses from catalog and POS bypass the role check used for `catalog.listProducts`. Keep permitted operational fields and redact restricted values at the response boundary without changing persisted snapshots or computations. Stock and daily report query selections already avoid cost fields.
2. **P1: Closing authorization and immutability.** Normal `closeShift` finalizes the operational shift but is not a separate close-day approval. Add actor ownership and record-state checks at mutation time. The historical edit/delete paths can alter or remove finalized data; any replacement adjustment workflow needs append-only storage, attribution and approval. Also review how sale/expense/debt corrections affect finalized reports.
3. **P1: Branch row boundaries.** Card-batch inventory has a branch column but reads return rows across branches. Ledger branch-scoping needs explicit treatment when loyalty is portable business-wide. Verify all actor and branch IDs server-side, including same-branch ownership.
4. **P2: Missing or broad menus.** Outside auth/session operations, the unmapped procedures are `ping`, `catalog.getSettings`, `catalog.getShopLogo`, `pos.currentShift`, and all four `assistant.*` procedures. The first four are shared utility/bootstrap paths; minimize their response fields. Map assistant configuration to `settings`; chat/action tool authorization uses per-tool menus and should also respect operational system access. Payment writes inherit a broad menu union.
5. **P2: Public loyalty self-service.** The anonymous procedure intentionally serves the loyalty page, but a phone number alone does not verify the caller owns the account; history includes transaction notes and branch names. Review the public disclosure and distributed limits with product ownership before changing the mobile/customer flow.
## HTTP, Edge and client entry points

The Node and Edge tRPC adapters use the same context and business routers. Their separate `dbadmin` imports both re-export the portable file router at this revision. The project publishable `apikey` is an Edge gateway prerequisite and carries no staff privilege.

| Entry point | Current server guard | Menu / required action | Branch, ownership or state check | Existing automated evidence |
| --- | --- | --- | --- | --- |
| Node `/api/trpc/<procedure>`, Vite development | Hono tRPC adapter, shared middleware and procedure guards | Per procedure | From authenticated staff, with resolver predicates detailed in the procedure inventory | `web/api/routers/deployment-boundaries.test.ts`, `web/api/middleware.*.test.ts` |
| Edge `pos-api/<procedure>`, including Vercel `/api/trpc/:procedure` rewrite | CORS allowlist, GET/POST, publishable key, process-local limit, shared tRPC guards. Supabase gateway JWT check disabled by design, staff checks remain inside tRPC | Per procedure | Shared context and resolver predicates, including the portable `dbadmin` implementation | `supabase/functions/pos-api/{apiKey,cors,index.deployment}.test.ts`, `web/api/router.edge.test.ts` |
| Edge `pos-api/ping`; Node `ping` | Edge key and rate limit with health shortcut; Node explicit anonymous procedure | None / public health | None, responds with status and timestamp | `index.deployment.test.ts`, `web/api/realtime.test.ts` |
| Node `POST /api/payments/incoming`; Edge `pos-api/payments/incoming` | Business deployment, branch webhook credential verified by shared handler. Edge deliberately bypasses the publishable key here | None / branch payment webhook credential | Matches pending, unexpired payment sessions by validated branch and exact amount. Duplicate lookup currently searches global `transRef` and can disclose a different branch's reference and receipt. Global replay protection is intentional | `web/api/boot.deployment.test.ts`, `index.deployment.test.ts`, `web/api/payments/incomingPayment.test.ts` has parsing tests, cross-branch duplicate case absent |
| Node `GET /api/realtime` | Business deployment and active staff at connection; subscriber lease capacity and token-expiry timer | None / signed-in branch invalidation subscription | Session resolves active branch and event dispatch matches it. Established stream remains open until token expiry or disconnect, including after later account/membership changes. Carries only invalidation metadata | `web/api/{boot.deployment,realtime}.test.ts`, `web/api/lib/realtime.test.ts` |
| Supabase Realtime `pos-invalidation-v1:<branchId>` | Private broadcast topic with Supabase Auth and RLS. Server-only publisher uses secret key | None / signed-in branch invalidation subscription | Policy joins `auth.uid()` to active staff and active branch. Admin all active branches, others designated default branch. Messages contain branch and opaque invalidation event ID | `web/api/lib/realtime-branch-authorization.test.ts` exercises the migration in PGlite. Hosted subscription reauthorization timing unverified |
| Node `POST /api/internal/database-backup` | Business deployment plus separate configured scheduler credential compared in constant time | None / scheduled database backup | Deployment database-wide, emits backup metadata only | `web/api/boot.deployment.test.ts`, `web/api/lib/databaseBackup.test.ts` |
| Node `GET /api/lan-info` | Unauthenticated currently. Recognized public cloud runtimes return empty URLs | Stock caller / local station discovery | May return host interface URLs on other runtimes. Used by signed-in stock counting. Pre-login LAN discovery is separately provided by `catalog.lanInfo` | No handler authorization test |
| Node unmatched `/api/*` | 404 | None | No resolver | Existing retired face route tests cover removed tRPC names |
| Edge `pos-assistant` | Gateway JWT enabled; forwards method, headers and request to fixed project `assistant.chat` with redirects disabled | Inherits `assistant.chat`: no menu mapping, authenticated staff with existing role checks on each tool | Shared tRPC authentication plus assistant tool-level capability and branch checks | `web/api/routers/assistant.test.ts` exercises shared router; no dedicated forwarding test |
| Edge `pos-loyalty/membership.customerPoints` and homogeneous batches | CORS, method and exact procedure allowlist; shared anonymous resolver and process-local lookup rate limit | None / public loyalty lookup | Normalized phone matches member, subsequent rows constrained to matching member ID. Returns partial masking, point history, notes and branch names; expiry processing is called in the public query. Product decision on stronger ownership proof belongs to public loyalty design | `supabase/functions/pos-loyalty/path.test.ts` checks mixed batch rejection, `web/api/routers/membership.test.ts` |
| Edge `pos-auth-bootstrap` including Vercel `/api/auth/bootstrap` rewrite | Allowed-origin and method checking, POST always returns 410 | None / retired | No credential processing or DB access | Runtime reviewed, no dedicated endpoint test located |
| Edge `pos-api-v2` | Gateway JWT enabled, handler always returns 410 | None / retired | No DB access | Runtime reviewed, no dedicated endpoint test located |
| Supabase Auth API | Supabase session issuance and verification, project publishable key used on clients, secret key used by server account provisioning | None / identity and session operations | Individual Supabase Auth ID links to unique nullable `staff_users.supabase_auth_user_id`. App role, account active flag and working branch are resolved by the staff API | `web/api/lib/supabaseAuth.test.ts` and `web/api/routers/staffAuth*.test.ts` |
| Supabase Storage product images | Public reads for catalog image bucket, uploads through server secret key and guarded catalog procedure | None for public image reads / existing catalog permission for writes | Content path and media constraints in `web/api/lib/productImageStorage.ts`; no staff/financial data intended | `web/api/lib/productImageStorage.test.ts`; hosted policies unverified |
| Supabase REST/GraphQL Data API | Local config exposes `public` and `graphql_public`; application `pos` schema excluded. Migrations revoke table/sequence privileges from client roles; application tables enable RLS | No direct POS table permission | Application row authorization occurs through the trusted API using the pooler. Realtime predicate is a narrowly scoped exception using authenticated role, an explicit execution grant and an empty search path | Static migration review, isolated Realtime predicate tests. Hosted schemas, grants and roles remain to be independently verified in staging |
| Electron loopback `/api/*` proxy | Loopback bind, configured deployment-origin binding, online requests forwarded to server. GET can fall back to a local disk cache | Inherits upstream for online requests | Cache key uses method, URL, body and Authorization, omits selected branch and local legacy session header. No cached authorization revalidation or age check; bootstrap excluded. Realtime is streamed without caching | `desktop/electron/offlineRuntime.{deployment,initialSetup}.test.ts`, no baseline branch/cache security coverage |
| Electron local IPC sale/recovery | Electron preload/main IPC and local deployment binding. Server replay routes through authenticated `pos.createSale` | POS role/menu on server replay | Queue and encrypted recovery bound to remote origin. Offline drafts are local until accepted upstream; replay and credential lifecycle require a separate audit before changing sales behavior | `desktop/electron/offlineRuntime.test.ts`, `offlineRuntime.deployment.test.ts` |
| Flutter and browser clients | Mobile uses Edge tRPC and Supabase Auth. Browser chooses same-origin or Edge; both send the bearer token and selected branch. Desktop uses same-origin through the loopback proxy | Per procedure; client navigation is secondary | All active staff API responses use upstream role and branch rules. Supabase Auth and private Realtime have dedicated client integrations | `mobile/test/core/network/trpc_client_test.dart`, `web/src/lib/trpcUrl.test.ts`, `web/src/lib/supabase.test.ts` |

### Platform and database boundaries

- Server-only `PUMPPOS_DEPLOYMENT_MODE` selects scope in `web/api/lib/deployment.ts`. `web/contracts/deployment.ts` denies `platform.*` in business mode and allows only platform procedures plus an explicit sign-in and setup-state allowlist in platform mode.
- All four `platform.*` registry procedures also use `adminQuery` and `requirePlatformDeployment()`. Authenticated middleware restricts platform sessions to platform-database `admin` accounts. The registry uses a dedicated platform database and records business project metadata, with no remote database access. Business Owner uses the existing `admin` identifier only in the business deployment. Keep this distinction when wiring business-only guards. See `web/api/routers/platform.ts`, `web/api/middleware.ts`, `docs/saas-deployment.md`, and `web/api/routers/deployment-boundaries.test.ts`.
- `web/db/schema.ts` already defines unique individual usernames and optional unique Supabase IDs, existing role identifiers, branch membership, RLS and JSONB menu permissions. Action policy can reuse those structures. No new role or action table is required for Task B.
- Migration evidence includes `20260721030947_initial_supabase.sql`, `20260724041452_supabase_auth_cutover.sql`, `20260808100442_explicit_server_only_rls_policies.sql` and `20260723093151_restrict_non_admin_realtime_to_default_branch.sql`. These are repository assertions, with no hosted-system audit performed.

### Direct entry point priorities

1. **High** — Scope webhook duplicate responses to the verified branch. Preserve the shared handler, settlement arithmetic and database-wide replay constraint.
2. **High** — Partition or restrict desktop offline caching so branch and staff authentication changes cannot cause a prior privileged response to be served across a branch or session. Treat the existing offline sale queue as a separate workflow.
3. **Medium** — Protect Node LAN interface disclosure inside the existing stock capability and review pre-login LAN discovery separately. Verify SSE subscription state after an account or branch change. Hosted Realtime revocation and public loyalty verification require staging or product follow-up.

## Task A verification

- Source inventory matched the router registrations at the audited SHA. It covers 199 distinct tRPC paths, including 26 auth and staffAuth procedures.
- `npm ci`, `npm run check` and `npm run lint` exited successfully.
- The targeted policy, menu, branch-access, PIN, Passkey, deployment and shift-permission baseline passed all 106 tests in seven files.
- The targeted direct-entry baseline passed all 38 tests in eight files, covering Node/Edge routing, Realtime authorization, webhook handling, loyalty routing and Electron proxy behavior.
- The baseline emitted Node Web Crypto experimental notices. The local tests use isolated fixtures and do not verify hosted Supabase configuration.

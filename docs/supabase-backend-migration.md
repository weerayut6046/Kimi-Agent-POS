# Supabase backend migration

PumpPOS uses a staged strangler migration so the current Railway API remains
available until each Supabase workload has passed production smoke tests. Do
not change the catch-all Vercel rewrite before the matching Supabase workload
is deployed and verified.

## Migration order

1. Keep the current Railway API healthy and take a tested database backup.
2. Deploy `pos-assistant` as a Supabase Edge gateway, test it directly, and
   route only `/api/trpc/assistant.chat` to it.
3. Bridge PumpPOS staff identities to Supabase Auth. Use private Realtime
   channels with RLS policies on `realtime.messages` before moving clients.
4. Move read-heavy business domains one at a time, with a rollback route for
   each domain.
5. Move write domains only after idempotency, transaction, authorization, and
   audit-log tests pass against the Supabase database.
6. Replace Railway-only backup/report jobs, run restore drills, then retire
   Railway after an agreed observation window.

### Stage 1: stock visibility reads

`catalog.listProducts`, `catalog.listTanks`, `catalog.lowStockAlerts`, and
`catalog.priceHistory` are served directly by the `pos-api` Edge Function using the dedicated
`pos_catalog_reader_live` database role. Earlier reader login roles are disabled
after pooler-safe credential rotations; rotate by creating a new role rather
than changing a password on a role already used by the pooler.
The role has `SELECT` access only to the catalog tables/columns needed by these
two procedures and is not a superuser or RLS bypass role. The Edge function
rechecks the staff identity (`id`, `username`, `role`, and `active`) against
`pos.staff_users` before every read. All catalog writes and other catalog reads
still use Railway until their transaction and audit guarantees are migrated.

The rollout is controlled by `CATALOG_READS_ENABLED=true` and the separate
`CATALOG_DB_URL` secret. Set the flag to `false` (or remove it) to route these
procedures back to Railway without changing data.

### Database bootstrap note

The application tables are owned by Drizzle and their canonical migrations live
under `web/db/migrations-postgres/`. The Supabase migrations in this directory
only contain changes that reference Supabase-managed schemas (Auth and
Realtime) plus security hardening. A new project must therefore be bootstrapped
with the Drizzle migrations first (`DIRECT_URL` pointed at the project), then
the Supabase migrations can be pushed. Do not run the bridge migrations against
a blank database or copy the remote migration history blindly.

## Transitional assistant gateway

`supabase/functions/pos-assistant` preserves the existing tRPC request and
response contract while the assistant implementation still runs on Railway.
The function is deliberately configured with `verify_jwt = false` only during
this bridge because the web app does not have Supabase Auth sessions yet. It
does not mean the route is public: the gateway verifies the existing PumpPOS
HMAC staff session itself before forwarding a request.

Security controls:

- accepts only `POST` and approved-origin `OPTIONS` requests;
- verifies the `x-staff-session` signature, claims, role, and expiry;
- permits only the configured production web origin;
- enforces the same message limits as the Railway assistant API;
- limits requests per staff account and retains the Railway-side rate limit;
- forwards only the JSON body and signed staff-session header to one fixed
  HTTPS upstream; cookies and browser authorization headers are stripped;
- applies an upstream timeout and response-size limit;
- returns `Cache-Control: no-store` and browser hardening headers;
- never logs chat text, session tokens, API keys, or database credentials.

The DeepSeek key and business-data tools remain inside the trusted Railway
backend in this phase. The Edge gateway must not receive a DeepSeek key or a
database service-role key.

## Required Edge Function secrets

Set these through the Supabase secret manager. Never commit them or paste their
values into tickets, chat, CI output, or shell history.

| Name                     | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `APP_SECRET`             | The same 32+ character HMAC secret used by the Railway API |
| `ASSISTANT_UPSTREAM_URL` | Fixed HTTPS URL of the Railway assistant tRPC endpoint     |
| `ALLOWED_ORIGINS`        | Comma-separated exact production origins                   |
| `CATALOG_READS_ENABLED`  | Explicit rollout switch for the Stage 1 read-only routes   |
| `CATALOG_DB_URL`         | URL for the least-privilege `pos_catalog_reader_live` role |

The target project ref is read from the operator's local environment. Before
deployment, authenticate the Supabase CLI with an account that has access to
that project. Prefer an ignored temporary env file with `supabase secrets set
--env-file ...` so values are not placed directly in command history.

## Deployment gate

Before routing traffic, all of the following must pass:

- repository typecheck, lint, unit tests, production build, and dependency
  audit;
- direct Edge smoke tests for no session, expired/tampered session, non-admin
  and admin staff, and an allowed production origin;
- an authenticated admin chat smoke test that exercises a read-only business
  tool without exposing its private result to DeepSeek;
- Railway health and assistant smoke tests remain green;
- a Vercel deployment containing only the assistant-specific rewrite is
  verified before promotion.

After Supabase Auth is live, replace the custom session bridge with Supabase
JWT verification and authorization based on server-validated app metadata.
Never authorize from user-editable metadata. Realtime channels must be private,
and access must be controlled by RLS policies.

## Rollback

Rollback is a routing change, not a data migration, in this phase. Restore the
previous Vercel deployment (or remove the assistant-specific rewrite) so
`/api/trpc/assistant.chat` again follows the Railway catch-all. Do not delete
the Railway service, DeepSeek secret, or its database access until the final
retirement phase and observation window are complete.

# Supabase mutation/RPC design gate

No write procedure may move from Railway until this design is implemented and
its transaction, idempotency, authorization, audit, and Realtime tests pass.
The first production rollout must be a low-risk admin mutation; sales, shifts,
stock deductions, payments, and authentication writes stay on Railway until a
separate observation window succeeds.

## Chosen execution model

- Keep the existing tRPC HTTP contract at `pos-api`.
- Verify the PumpPOS HMAC staff session at the Edge and re-read the matching
  active staff row before every call, as catalog reads already do.
- Execute exactly one schema-qualified Postgres function for a mutation. The
  function owns the complete transaction: authorization, locks, domain writes,
  audit row, idempotency result, PostgreSQL notification, and private Supabase
  Broadcast.
- Use a dedicated versioned login such as `pos_mutation_edge_v1`. It receives
  `USAGE` on a non-exposed RPC schema and `EXECUTE` only on allow-listed
  functions. It receives no direct table DML, no role inheritance, no
  `BYPASSRLS`, and no superuser privileges.
- Own `SECURITY DEFINER` functions with a non-login `pos_rpc_owner` role, not
  the login role and not a browser-facing role. Every function must set
  `search_path = ''`, schema-qualify all objects, validate the calling staff
  identity explicitly, and have `EXECUTE` revoked from `PUBLIC`, `anon`,
  `authenticated`, and `service_role` unless a later design deliberately uses
  a Supabase JWT RPC.
- Connect through Supavisor transaction mode with prepared statements disabled,
  a one-connection client pool, short idle/connect timeouts, and bounded role
  connections. Never perform HTTP, Storage, payment, or AI calls while the
  database transaction is open.

The database credential is a trusted server credential. Rotate it by creating a
new versioned login and disabling the old login; do not change the password of a
role already cached by the pooler.

## RPC request contract

Every migrated mutation must include:

- `requestId`: client-generated UUID retained across retries of the same user
  action;
- actor claims from the verified session: staff id, username, and role;
- a typed business payload with the same validation limits as the Railway
  router;
- an RPC version in the procedure/function name when a breaking contract is
  introduced.

The Edge rejects missing/malformed input before opening a database transaction.
The function then verifies that the staff row is active and that id, username,
and role all match. It applies the exact existing role rule for that procedure
(`authenticated`, `manager-or-admin`, or `admin`) rather than relying on a broad
database role.

## Idempotency

Create a private table conceptually equivalent to:

```sql
create table pos.api_idempotency (
  actor_id integer not null,
  procedure text not null,
  request_id uuid not null,
  request_hash bytea not null,
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_id, procedure, request_id)
);
```

The RPC computes `request_hash` from a canonical `jsonb` representation of the
typed payload. It inserts the key with `INSERT ... ON CONFLICT DO NOTHING`.

- New key: perform the domain mutation and store the final response in the same
  transaction.
- Existing key with the same hash: return the stored response without another
  domain write, audit row, or broadcast.
- Existing key with a different hash: raise a conflict that the gateway maps to
  HTTP 409.
- Failed transaction: the key insert rolls back, so a retry can run normally.

A scheduled cleanup may remove old completed rows only after the longest client
retry/offline window is agreed. It must not delete pending rows or become part
of the request path.

## Transaction and locking rules

- Keep one user action in one Postgres function/transaction; never dual-write
  Railway and Supabase.
- Validate non-locking input first, then lock all affected rows in ascending
  primary-key order with `FOR UPDATE` where a read-modify-write invariant is
  required.
- Prefer a single conditional `UPDATE ... WHERE ... RETURNING` over
  select-then-update. Use `INSERT ... ON CONFLICT` for settings and other
  upserts.
- Set local statement and lock timeouts. Map constraint, timeout, and conflict
  failures to stable tRPC errors without returning SQL text.
- Audit and invalidation are part of the same transaction. A failed audit insert
  must roll back the business change.
- Do not silently fall back to Railway after an RPC error. Rollback is an
  explicit per-procedure routing flag to avoid duplicate writes.

## Audit contract

Each successful new request inserts exactly one `pos.audit_logs` row in the RPC
transaction. It records the verified actor, action, safe summary, reference type
and id, and the request id (add a dedicated request-id column before rollout).
Do not store session tokens, PINs, secrets, database URLs, raw authorization
headers, full request JSON, or unnecessary customer data.

The current asynchronous `logAudit()` helper is not sufficient for migrated
writes because it runs outside the business transaction. Railway may keep it
during the transition, but every migrated RPC must use the transactional audit
path.

## Realtime invalidation contract

Create one opaque event per newly committed request:

```json
{ "version": 1, "eventId": "<uuid>", "scope": "all" }
```

The RPC publishes the same event in the transaction through both channels:

1. `pg_notify('pos_app_invalidation_v1', event::text)` for the existing Railway
   listener/SSE bridge; PostgreSQL delivers it only after commit.
2. `realtime.send(event, 'invalidate', 'pos-invalidation-v1', true)` for the
   private Supabase channel governed by the existing `realtime.messages` RLS
   policy.

Never include row payloads, customer data, audit details, or credentials in an
event. Idempotent replays and rolled-back transactions publish no new event.
Client polling remains the recovery path for missed events.

## Required automated tests

### Transaction

- A domain constraint failure leaves every affected table unchanged.
- A forced audit failure rolls back the domain change and idempotency row.
- Concurrent stock/shift requests preserve non-negative totals and other
  invariants; multi-row tests use deterministic lock ordering.
- Timeouts and deadlocks return sanitized retryable errors.

### Idempotency

- Sequential and concurrent calls with the same key/payload produce one domain
  change, one audit row, one event id, and the same response.
- The same key with a changed payload returns conflict and changes nothing.
- Retrying after a simulated network timeout returns the committed result.

### Authorization

- Missing, expired, tampered, inactive, renamed, or role-changed staff sessions
  fail before domain access.
- Each role boundary matches the current Railway middleware and menu model.
- The login role cannot directly select sensitive columns or insert/update/
  delete domain tables, audit rows, or idempotency rows.
- RPC functions are not executable by `PUBLIC`, `anon`, `authenticated`, or
  unrelated server roles.

### Audit and Realtime

- Audit actor/reference/request id are correct and secret fields are absent.
- Audit insertion failure rolls back the mutation.
- Commit emits one opaque PostgreSQL notification and one private Broadcast;
  rollback/replay emits none.
- A valid Supabase staff session can subscribe, while anonymous/inactive staff
  cannot; reconnect still triggers a full cache refetch.

## Rollout order

1. Build the roles, idempotency table, audit request id, shared authorization
   helper, event helper, and tests on a non-production branch/database.
2. Run security/performance advisors and inspect grants/policies/functions.
3. Pilot one low-risk admin mutation behind its own routing flag (for example a
   small settings update excluding `shop_logo`).
4. Observe errors, duplicates, audit completeness, locks, connections, and
   Realtime delivery before expanding one procedure at a time.
5. Move stock, shift, sale, payment, and other financial workflows last.

Production promotion requires a tested backup and restore point, a rollback
route, full repository verification, and an authenticated browser smoke test.

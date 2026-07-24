-- One-time, rate-limited migration state for moving legacy PIN accounts to
-- Supabase Auth. This table is server-only and is never exposed through the
-- Data API.
create table if not exists pos.auth_migration_attempts (
  identity_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table pos.auth_migration_attempts enable row level security;
revoke all on table pos.auth_migration_attempts from public, anon, authenticated;

comment on table pos.auth_migration_attempts is
  'Server-only throttling state for the one-time legacy PIN to Supabase Auth migration.';

-- Data API roles remain deny-all on every application table. The Edge API
-- authenticates the caller with Supabase Auth, then performs branch/role
-- authorization in the application router using the transaction pooler.
revoke all on all tables in schema pos from anon, authenticated;
revoke all on all sequences in schema pos from anon, authenticated;

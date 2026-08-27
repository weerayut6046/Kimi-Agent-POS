-- Keep foreign-key maintenance and joins from falling back to table scans.
-- Fail quickly instead of waiting behind a long-running production transaction.
SET lock_timeout = '5s';
SET statement_timeout = '2min';

CREATE INDEX IF NOT EXISTS "login_attempt_branch_idx"
  ON "pos"."login_attempts" ("branch_id");

CREATE INDEX IF NOT EXISTS "security_event_actor_idx"
  ON "pos"."security_events" ("actor_id");

CREATE INDEX IF NOT EXISTS "stockcountitem_counted_by_idx"
  ON "pos"."stock_count_items" ("counted_by_id");

CREATE INDEX IF NOT EXISTS "stockcountsession_started_by_idx"
  ON "pos"."stock_count_sessions" ("started_by_id");

CREATE INDEX IF NOT EXISTS "stockcountsession_completed_by_idx"
  ON "pos"."stock_count_sessions" ("completed_by_id");

CREATE INDEX IF NOT EXISTS "tankreading_staff_idx"
  ON "pos"."tank_readings" ("staff_id");

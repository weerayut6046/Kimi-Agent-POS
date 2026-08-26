-- บัตรสมาชิกมีอายุ 1 ปีนับจากวันเปิดใช้งาน
-- สมาชิกเดิมให้นับอายุจากวันสมัครเดิม เพื่อไม่ต่ออายุให้อัตโนมัติโดยไม่ตั้งใจ
ALTER TABLE "pos"."members" ADD COLUMN "card_activated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "pos"."members" ADD COLUMN "card_expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "pos"."members"
SET
  "card_activated_at" = "created_at",
  "card_expires_at" = "created_at" + interval '1 year'
WHERE "card_activated_at" IS NULL OR "card_expires_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pos"."members" ALTER COLUMN "card_activated_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "pos"."members" ALTER COLUMN "card_activated_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "pos"."members" ALTER COLUMN "card_expires_at" SET DEFAULT now() + interval '1 year';
--> statement-breakpoint
ALTER TABLE "pos"."members" ALTER COLUMN "card_expires_at" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "members_card_expiry_due_idx"
ON "pos"."members" USING btree ("card_expires_at")
WHERE "points" > 0;
--> statement-breakpoint
ALTER TABLE "pos"."members"
ADD CONSTRAINT "members_card_validity_check"
CHECK ("card_expires_at" > "card_activated_at");
--> statement-breakpoint

-- ล็อกเฉพาะบัตรที่ถึงกำหนด ตัดยอดเป็นศูนย์ และบันทึกหลักฐานใน transaction เดียว
CREATE OR REPLACE FUNCTION "pos"."expire_member_points"(
  "p_branch_id" integer DEFAULT NULL,
  "p_now" timestamp with time zone DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  expired_count integer := 0;
BEGIN
  WITH due AS MATERIALIZED (
    SELECT
      m."id",
      m."points",
      COALESCE(
        p_branch_id,
        (
          SELECT pt."branch_id"
          FROM "pos"."point_transactions" pt
          WHERE pt."member_id" = m."id"
          ORDER BY pt."created_at" DESC, pt."id" DESC
          LIMIT 1
        ),
        "pos"."default_branch_id"()
      ) AS branch_id
    FROM "pos"."members" m
    WHERE m."points" > 0
      AND m."card_expires_at" <= p_now
    FOR UPDATE OF m SKIP LOCKED
  ), cleared AS (
    UPDATE "pos"."members" m
    SET "points" = 0
    FROM due
    WHERE m."id" = due."id"
    RETURNING due."id", due."points", due.branch_id
  ), logged AS (
    INSERT INTO "pos"."point_transactions" (
      "branch_id",
      "member_id",
      "type",
      "points",
      "note",
      "created_at"
    )
    SELECT
      cleared.branch_id,
      cleared."id",
      'expire',
      -cleared."points",
      'แต้มหมดอายุอัตโนมัติ เมื่อบัตรครบอายุ 1 ปี',
      p_now
    FROM cleared
    RETURNING 1
  )
  SELECT count(*)::integer INTO expired_count FROM logged;

  RETURN expired_count;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "pos"."expire_member_points"(integer, timestamp with time zone)
FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- ตัดยอดสมาชิกที่ครบกำหนดอยู่แล้วทันทีเมื่อ deploy migration
SELECT "pos"."expire_member_points"();
--> statement-breakpoint

-- Supabase มี pg_cron ให้ใช้ แต่ PGlite/local test ไม่มี จึงเปิดและตั้งงานเฉพาะเมื่อรองรับ
DO $cron_setup$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
      EXECUTE 'CREATE EXTENSION pg_cron';
    END IF;

    -- ชื่อเดิมจะถูก upsert ตามพฤติกรรม pg_cron จึงรัน migrationซ้ำได้อย่างปลอดภัย
    PERFORM cron.schedule(
      'expire-member-points-hourly',
      '5 * * * *',
      'SELECT pos.expire_member_points()'
    );
  END IF;
END
$cron_setup$;

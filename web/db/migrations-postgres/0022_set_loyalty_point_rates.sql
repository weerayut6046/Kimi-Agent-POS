-- กติกาสมาชิกของทุกสาขา: ยอดสุทธิทุก 100 บาทได้ 1 แต้ม
-- และใช้ 1 แต้มเป็นส่วนลดท้ายบิลได้ 1 บาท
INSERT INTO "pos"."settings" ("branch_id", "key", "value")
SELECT "id", 'point_earn_per_baht', '100'
FROM "pos"."branches"
ON CONFLICT ("branch_id", "key")
DO UPDATE SET "value" = EXCLUDED."value";
--> statement-breakpoint
INSERT INTO "pos"."settings" ("branch_id", "key", "value")
SELECT "id", 'point_redeem_value', '1'
FROM "pos"."branches"
ON CONFLICT ("branch_id", "key")
DO UPDATE SET "value" = EXCLUDED."value";

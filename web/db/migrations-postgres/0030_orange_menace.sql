ALTER TABLE "pos"."shift_readings" ADD COLUMN "cost_per_liter" numeric(18, 3) DEFAULT 0 NOT NULL;

UPDATE "pos"."shift_readings" AS "reading"
SET "cost_per_liter" = "product"."cost"
FROM "pos"."nozzles" AS "nozzle"
JOIN "pos"."products" AS "product"
  ON "product"."id" = "nozzle"."product_id"
 AND "product"."branch_id" = "nozzle"."branch_id"
WHERE "reading"."nozzle_id" = "nozzle"."id"
  AND "reading"."branch_id" = "nozzle"."branch_id"
  AND "reading"."cost_per_liter" = 0;

COMMENT ON COLUMN "pos"."shift_readings"."cost_per_liter" IS
  'Fuel cost snapshot per liter captured when the shift reading is opened';

ALTER TABLE "pos"."sale_items" ADD COLUMN "cost_per_unit" numeric(18, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sale_items" ADD COLUMN "product_category" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
UPDATE "pos"."sale_items" AS "sale_item"
SET
	"cost_per_unit" = "product"."cost",
	"product_category" = "product"."category"
FROM "pos"."products" AS "product"
WHERE
	"sale_item"."product_id" = "product"."id"
	AND "sale_item"."branch_id" = "product"."branch_id";--> statement-breakpoint
UPDATE "pos"."staff_access_groups"
SET
	"menu_permissions" = "menu_permissions" || '["profitability"]'::jsonb,
	"updated_at" = now()
WHERE
	"name" = 'ผู้จัดการ'
	AND "role" = 'manager'
	AND NOT ("menu_permissions" @> '["profitability"]'::jsonb);

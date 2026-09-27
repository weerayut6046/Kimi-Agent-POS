set lock_timeout = '5s';
set statement_timeout = '2min';

alter table "pos"."sale_items"
  add column "cost_per_unit" numeric(18, 3) default 0 not null,
  add column "product_category" text default 'other' not null;

-- Existing rows cannot recover a historical cost that was never stored, so use
-- the current product cost once. Every new sale snapshots its own cost below.
update "pos"."sale_items" as "sale_item"
set
  "cost_per_unit" = "product"."cost",
  "product_category" = "product"."category"
from "pos"."products" as "product"
where
  "sale_item"."product_id" = "product"."id"
  and "sale_item"."branch_id" = "product"."branch_id";

-- Keep the built-in manager access group aligned with the central role default.
-- Custom access groups remain unchanged so admin choices are preserved.
update "pos"."staff_access_groups"
set
  "menu_permissions" = "menu_permissions" || '["profitability"]'::jsonb,
  "updated_at" = now()
where
  "name" = 'ผู้จัดการ'
  and "role" = 'manager'
  and not ("menu_permissions" @> '["profitability"]'::jsonb);

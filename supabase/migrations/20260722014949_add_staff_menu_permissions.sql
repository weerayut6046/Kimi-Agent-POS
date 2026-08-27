alter table "pos"."staff_users"
  add column if not exists "menu_permissions" jsonb;;

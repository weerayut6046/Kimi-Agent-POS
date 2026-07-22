-- Supabase's pooler can retain authentication metadata after a login role is
-- dropped and recreated. Rotate to a fresh role instead of relying on a
-- password update for the old login. The old role is retained without LOGIN
-- so no existing ACL dependency can accidentally reopen it.
alter role pos_catalog_reader NOLOGIN;
revoke all on schema pos from pos_catalog_reader;
revoke all on pos.fuel_tanks, pos.products, pos.nozzles, pos.settings,
  pos.staff_users from pos_catalog_reader;

drop policy if exists pos_catalog_reader_fuel_tanks_select on pos.fuel_tanks;
drop policy if exists pos_catalog_reader_products_select on pos.products;
drop policy if exists pos_catalog_reader_nozzles_select on pos.nozzles;
drop policy if exists pos_catalog_reader_settings_select on pos.settings;
drop policy if exists pos_catalog_reader_staff_users_select on pos.staff_users;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pos_catalog_reader_edge') then
    create role pos_catalog_reader_edge
      login
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls
      connection limit 5;
  end if;
end
$$;

alter role pos_catalog_reader_edge set statement_timeout = '5s';
alter role pos_catalog_reader_edge set idle_in_transaction_session_timeout = '10s';

revoke all on schema pos from pos_catalog_reader_edge;
grant usage on schema pos to pos_catalog_reader_edge;
revoke all on pos.fuel_tanks, pos.products, pos.nozzles, pos.settings,
  pos.staff_users from pos_catalog_reader_edge;

grant select (
  id,
  product_id,
  name,
  capacity_liters,
  current_liters,
  low_alert_at
) on pos.fuel_tanks to pos_catalog_reader_edge;
grant select (
  id,
  code,
  name,
  category,
  unit,
  price,
  cost,
  stock_qty,
  low_stock_at,
  created_at,
  active
) on pos.products to pos_catalog_reader_edge;
grant select (id, tank_id) on pos.nozzles to pos_catalog_reader_edge;
grant select (key, value) on pos.settings to pos_catalog_reader_edge;
grant select (id, username, role, active)
  on pos.staff_users to pos_catalog_reader_edge;

create policy pos_catalog_reader_edge_fuel_tanks_select
  on pos.fuel_tanks for select to pos_catalog_reader_edge using (true);
create policy pos_catalog_reader_edge_products_select
  on pos.products for select to pos_catalog_reader_edge using (true);
create policy pos_catalog_reader_edge_nozzles_select
  on pos.nozzles for select to pos_catalog_reader_edge using (true);
create policy pos_catalog_reader_edge_settings_select
  on pos.settings for select to pos_catalog_reader_edge using (true);
create policy pos_catalog_reader_edge_staff_users_select
  on pos.staff_users for select to pos_catalog_reader_edge using (true);

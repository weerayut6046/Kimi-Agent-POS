-- Dedicated least-privilege login for the read-only catalog workload.
-- The password is provisioned out-of-band and stored only in Supabase secrets.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pos_catalog_reader') then
    create role pos_catalog_reader
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

alter role pos_catalog_reader set statement_timeout = '5s';
alter role pos_catalog_reader set idle_in_transaction_session_timeout = '10s';

revoke all on schema pos from pos_catalog_reader;
grant usage on schema pos to pos_catalog_reader;

revoke all on pos.fuel_tanks, pos.products, pos.nozzles, pos.settings,
  pos.staff_users from pos_catalog_reader;
grant select on pos.fuel_tanks, pos.products, pos.nozzles to pos_catalog_reader;
grant select (key, value) on pos.settings to pos_catalog_reader;
grant select (id, username, role, active) on pos.staff_users to pos_catalog_reader;

-- RLS is already enabled on these application tables. These policies expose
-- rows only to this exact role; column grants above keep staff PINs and other
-- private columns out of the Edge connection altogether.
create policy pos_catalog_reader_fuel_tanks_select
  on pos.fuel_tanks for select to pos_catalog_reader using (true);
create policy pos_catalog_reader_products_select
  on pos.products for select to pos_catalog_reader using (true);
create policy pos_catalog_reader_nozzles_select
  on pos.nozzles for select to pos_catalog_reader using (true);
create policy pos_catalog_reader_settings_select
  on pos.settings for select to pos_catalog_reader using (true);
create policy pos_catalog_reader_staff_users_select
  on pos.staff_users for select to pos_catalog_reader using (true);

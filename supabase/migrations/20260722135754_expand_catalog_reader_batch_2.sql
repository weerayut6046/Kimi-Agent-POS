-- Batch 2 keeps the existing Edge login read-only while exposing only the
-- columns required by listPumps, listRefills, getSettings, and getShopLogo.
-- Warm Edge workers briefly overlap, so five backend sessions was too low for
-- concurrent catalog reads even with a one-connection client pool.
alter role pos_catalog_reader_live connection limit 12;

revoke all on pos.pumps, pos.tank_refills from pos_catalog_reader_live;
revoke all on pos.nozzles from pos_catalog_reader_live;

grant select (
  id,
  name,
  active
) on pos.pumps to pos_catalog_reader_live;
grant select (
  id,
  pump_id,
  product_id,
  tank_id,
  label,
  current_meter,
  current_money,
  active
) on pos.nozzles to pos_catalog_reader_live;
grant select (
  id,
  tank_id,
  liters,
  cost_per_liter,
  note,
  created_at
) on pos.tank_refills to pos_catalog_reader_live;

drop policy if exists pos_catalog_reader_live_pumps_select on pos.pumps;
create policy pos_catalog_reader_live_pumps_select
  on pos.pumps for select to pos_catalog_reader_live using (true);

drop policy if exists pos_catalog_reader_live_tank_refills_select
  on pos.tank_refills;
create policy pos_catalog_reader_live_tank_refills_select
  on pos.tank_refills for select to pos_catalog_reader_live using (true);

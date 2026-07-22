-- Keep the reader's ACL column-scoped even if the catalog schema gains
-- operational fields later. The procedure only needs these projections.
revoke all on pos.fuel_tanks, pos.products, pos.nozzles from pos_catalog_reader;

grant select (
  id,
  product_id,
  name,
  capacity_liters,
  current_liters,
  low_alert_at
) on pos.fuel_tanks to pos_catalog_reader;

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
) on pos.products to pos_catalog_reader;

grant select (id, tank_id) on pos.nozzles to pos_catalog_reader;

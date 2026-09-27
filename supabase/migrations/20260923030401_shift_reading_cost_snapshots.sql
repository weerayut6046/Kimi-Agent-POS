-- Preserve the fuel cost used by each meter shift so P-based profitability
-- remains stable when the product's current cost changes later.
alter table pos.shift_readings
  add column if not exists cost_per_liter numeric(18, 3) not null default 0;

-- Existing readings predate the snapshot. The best available historical
-- baseline is the current cost of the product linked to that nozzle.
update pos.shift_readings as reading
set cost_per_liter = product.cost
from pos.nozzles as nozzle
join pos.products as product
  on product.id = nozzle.product_id
 and product.branch_id = nozzle.branch_id
where reading.nozzle_id = nozzle.id
  and reading.branch_id = nozzle.branch_id
  and reading.cost_per_liter = 0;

comment on column pos.shift_readings.cost_per_liter is
  'Fuel cost snapshot per liter captured when the shift reading is opened';

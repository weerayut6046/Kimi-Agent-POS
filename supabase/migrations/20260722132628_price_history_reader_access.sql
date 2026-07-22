revoke all on pos.price_changes from pos_catalog_reader_live;
grant select (
  id,
  product_id,
  product_code,
  product_name,
  old_price,
  new_price,
  changed_by,
  created_at
) on pos.price_changes to pos_catalog_reader_live;

create policy pos_catalog_reader_live_price_changes_select
  on pos.price_changes for select to pos_catalog_reader_live using (true);

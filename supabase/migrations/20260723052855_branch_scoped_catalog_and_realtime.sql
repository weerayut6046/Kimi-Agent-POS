-- The application-owned Drizzle migration creates the branch tables and branch_id
-- columns before this Supabase-owned security migration is applied.

create or replace function pos.current_catalog_branch_id()
returns integer
language sql
stable
security invoker
set search_path = ''
as $function$
  select case
    when current_setting('app.branch_id', true) ~ '^[1-9][0-9]*$'
      then current_setting('app.branch_id', true)::integer
    else null
  end;
$function$;

revoke all on function pos.current_catalog_branch_id() from public;
revoke all on function pos.current_catalog_branch_id() from anon;
revoke all on function pos.current_catalog_branch_id() from authenticated;
grant execute on function pos.current_catalog_branch_id()
  to pos_catalog_reader_live;

revoke all on pos.branches, pos.staff_branches
  from pos_catalog_reader_live;
grant select (id, active) on pos.branches
  to pos_catalog_reader_live;
grant select (staff_id, branch_id) on pos.staff_branches
  to pos_catalog_reader_live;

grant select (branch_id) on
  pos.products,
  pos.pumps,
  pos.nozzles,
  pos.fuel_tanks,
  pos.tank_refills,
  pos.price_changes,
  pos.settings
to pos_catalog_reader_live;

drop policy if exists pos_catalog_reader_live_branches_select
  on pos.branches;
create policy pos_catalog_reader_live_branches_select
  on pos.branches
  for select
  to pos_catalog_reader_live
  using (id = (select pos.current_catalog_branch_id()));

drop policy if exists pos_catalog_reader_live_staff_branches_select
  on pos.staff_branches;
create policy pos_catalog_reader_live_staff_branches_select
  on pos.staff_branches
  for select
  to pos_catalog_reader_live
  using (branch_id = (select pos.current_catalog_branch_id()));

drop policy if exists pos_catalog_reader_live_products_select
  on pos.products;
create policy pos_catalog_reader_live_products_select
  on pos.products
  for select
  to pos_catalog_reader_live
  using (branch_id = (select pos.current_catalog_branch_id()));

drop policy if exists pos_catalog_reader_live_pumps_select
  on pos.pumps;
create policy pos_catalog_reader_live_pumps_select
  on pos.pumps
  for select
  to pos_catalog_reader_live
  using (branch_id = (select pos.current_catalog_branch_id()));

drop policy if exists pos_catalog_reader_live_nozzles_select
  on pos.nozzles;
create policy pos_catalog_reader_live_nozzles_select
  on pos.nozzles
  for select
  to pos_catalog_reader_live
  using (branch_id = (select pos.current_catalog_branch_id()));

drop policy if exists pos_catalog_reader_live_fuel_tanks_select
  on pos.fuel_tanks;
create policy pos_catalog_reader_live_fuel_tanks_select
  on pos.fuel_tanks
  for select
  to pos_catalog_reader_live
  using (branch_id = (select pos.current_catalog_branch_id()));

drop policy if exists pos_catalog_reader_live_tank_refills_select
  on pos.tank_refills;
create policy pos_catalog_reader_live_tank_refills_select
  on pos.tank_refills
  for select
  to pos_catalog_reader_live
  using (branch_id = (select pos.current_catalog_branch_id()));

drop policy if exists pos_catalog_reader_live_price_changes_select
  on pos.price_changes;
create policy pos_catalog_reader_live_price_changes_select
  on pos.price_changes
  for select
  to pos_catalog_reader_live
  using (branch_id = (select pos.current_catalog_branch_id()));

drop policy if exists pos_catalog_reader_live_settings_select
  on pos.settings;
create policy pos_catalog_reader_live_settings_select
  on pos.settings
  for select
  to pos_catalog_reader_live
  using (branch_id = (select pos.current_catalog_branch_id()));

create or replace function pos.can_receive_realtime_broadcast(
  requested_topic text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with requested as (
    select substring(
      requested_topic
      from '^pos-invalidation-v1:([1-9][0-9]*)$'
    )::integer as branch_id
  )
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from requested
      join pos.branches branch
        on branch.id = requested.branch_id
       and branch.active = true
      join pos.staff_users staff
        on staff.supabase_auth_user_id = (select auth.uid())
       and staff.active = true
      where
        staff.role = 'admin'
        or exists (
          select 1
          from pos.staff_branches membership
          where membership.staff_id = staff.id
            and membership.branch_id = requested.branch_id
        )
    );
$function$;

revoke all on function pos.can_receive_realtime_broadcast(text) from public;
revoke all on function pos.can_receive_realtime_broadcast(text) from anon;
grant execute on function pos.can_receive_realtime_broadcast(text)
  to authenticated;

drop policy if exists "active staff can receive pos invalidations"
  on realtime.messages;

create policy "branch staff can receive pos invalidations"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (
    select pos.can_receive_realtime_broadcast(
      (select realtime.topic())
    )
  )
);

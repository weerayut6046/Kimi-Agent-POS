-- Managers and cashiers may only subscribe to the Realtime topic for their
-- default working branch. Administrators retain access to every active branch.
grant select (is_default) on pos.staff_branches
  to pos_catalog_reader_live;

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
            and membership.is_default = true
        )
    );
$function$;

revoke all on function pos.can_receive_realtime_broadcast(text) from public;
revoke all on function pos.can_receive_realtime_broadcast(text) from anon;
grant execute on function pos.can_receive_realtime_broadcast(text)
  to authenticated;

-- The application-owned Drizzle migration adds this column first. Keep the
-- Auth foreign key and Realtime policy in Supabase migrations because they
-- reference Supabase-managed schemas.
alter table pos.staff_users
  add constraint staff_users_supabase_auth_user_id_fkey
  foreign key (supabase_auth_user_id)
  references auth.users(id)
  on delete set null;

comment on column pos.staff_users.supabase_auth_user_id is
  'Server-managed link to Supabase Auth. Never authorize from user_metadata.';

create or replace function pos.can_receive_realtime_broadcast(
  requested_topic text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    requested_topic = 'pos-invalidation-v1'
    and (select auth.uid()) is not null
    and exists (
      select 1
      from pos.staff_users as staff
      where staff.supabase_auth_user_id = (select auth.uid())
        and staff.active = true
    );
$function$;

revoke all on function pos.can_receive_realtime_broadcast(text) from public;
revoke all on function pos.can_receive_realtime_broadcast(text) from anon;
grant execute on function pos.can_receive_realtime_broadcast(text)
  to authenticated;

drop policy if exists "active staff can receive pos invalidations"
  on realtime.messages;

create policy "active staff can receive pos invalidations"
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

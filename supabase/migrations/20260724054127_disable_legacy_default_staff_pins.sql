update pos.staff_users
set pin = 'supabase-auth-pending:' || gen_random_uuid()::text
where active = true
  and supabase_auth_user_id is null
  and (
    (
      role = 'manager'
      and pin = encode(
        digest(convert_to('2222', 'UTF8'), 'sha256'),
        'hex'
      )
    )
    or (
      role = 'cashier'
      and pin = encode(
        digest(convert_to('0000', 'UTF8'), 'sha256'),
        'hex'
      )
    )
  );

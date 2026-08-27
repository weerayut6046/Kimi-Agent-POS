do $$
begin
  if to_regclass('pos.assistant_settings') is null then
    raise exception 'pos.assistant_settings is missing';
  end if;
  if to_regclass('pos.assistant_action_proposals') is null then
    raise exception 'pos.assistant_action_proposals is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'pos'
      and table_name = 'assistant_action_proposals'
      and column_name = 'idempotency_key'
      and is_nullable = 'NO'
  ) then
    raise exception 'pos.assistant_action_proposals.idempotency_key is missing or nullable';
  end if;
  if to_regclass('pos.payroll_staff_idx') is null then
    raise exception 'pos.payroll_staff_idx is missing';
  end if;
end $$;

insert into drizzle.__drizzle_migrations (hash, created_at)
select '263ae81e86e180ff61ec453e03e64061db43d9dc2ce93ecc5e2cfb5128d740f4', 1784857771939
where not exists (select 1 from drizzle.__drizzle_migrations where created_at = 1784857771939);

insert into drizzle.__drizzle_migrations (hash, created_at)
select '2fa67638ca771548f79da01149a3a460cb70d38e213c9e30c2a4019ec811024c', 1784862000000
where not exists (select 1 from drizzle.__drizzle_migrations where created_at = 1784862000000);

insert into drizzle.__drizzle_migrations (hash, created_at)
select '034a41b2fb2edfa30415f259d1e0ee71bd4053ec5236aaf1a19d37b37749d9a6', 1784863800000
where not exists (select 1 from drizzle.__drizzle_migrations where created_at = 1784863800000);

insert into drizzle.__drizzle_migrations (hash, created_at)
select '472e27778889ae5b34f4520c959579cc00cdf37b0dec5a767b978a768005cf96', 1784870931500
where not exists (select 1 from drizzle.__drizzle_migrations where created_at = 1784870931500);;

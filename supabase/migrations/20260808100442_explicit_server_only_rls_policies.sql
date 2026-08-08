-- The application reads and writes the pos schema only through the trusted
-- Edge API PostgreSQL connection. The schema is not exposed by PostgREST and
-- browser roles must not receive direct table access.
--
-- Restrictive false policies make that intent explicit for Security Advisor
-- and keep access denied even if a permissive client policy is added later.
-- Do not FORCE ROW LEVEL SECURITY: the server connection owns these tables.

revoke all on table
  pos.assistant_action_proposals,
  pos.assistant_settings,
  pos.audit_logs,
  pos.auth_migration_attempts,
  pos.customers,
  pos.debt_payments,
  pos.employee_profiles,
  pos.expenses,
  pos.members,
  pos.payment_sessions,
  pos.payment_settings,
  pos.payroll_records,
  pos.point_transactions,
  pos.reward_redemptions,
  pos.rewards,
  pos.sale_items,
  pos.sales,
  pos.shift_readings,
  pos.shifts,
  pos.staff_access_groups,
  pos.stock_count_items,
  pos.stock_count_sessions,
  pos.tank_readings,
  pos.tax_invoices,
  pos.work_schedules,
  pos.work_shift_templates
from public, anon, authenticated;

create policy server_only_deny_client_access
  on pos.assistant_action_proposals
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.assistant_settings
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.audit_logs
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.auth_migration_attempts
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.customers
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.debt_payments
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.employee_profiles
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.expenses
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.members
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.payment_sessions
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.payment_settings
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.payroll_records
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.point_transactions
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.reward_redemptions
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.rewards
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.sale_items
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.sales
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.shift_readings
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.shifts
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.staff_access_groups
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.stock_count_items
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.stock_count_sessions
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.tank_readings
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.tax_invoices
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.work_schedules
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy server_only_deny_client_access
  on pos.work_shift_templates
  as restrictive for all to anon, authenticated
  using (false) with check (false);

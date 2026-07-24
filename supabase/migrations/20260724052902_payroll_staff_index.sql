create index if not exists payroll_staff_idx
  on pos.payroll_records using btree (staff_id);

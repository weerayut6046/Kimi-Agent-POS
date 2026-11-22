CREATE TABLE pos.tank_withdrawals (
  branch_id integer NOT NULL,
  shift_id integer NOT NULL,
  tank_id integer NOT NULL,
  product_id integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  liters numeric(18,3) NOT NULL CONSTRAINT tank_withdrawal_liters_check CHECK (liters >= 0),
  PRIMARY KEY (shift_id, tank_id)
);
CREATE INDEX tank_withdrawal_period_idx ON pos.tank_withdrawals(branch_id, occurred_at);
ALTER TABLE pos.tank_withdrawals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos.tank_withdrawals FROM anon, authenticated;

-- Legacy releases did not record the actual deduction. Approximate it once from the
-- available readings, excluding history-only shifts that never changed stock.
CREATE VIEW pos.legacy_tank_withdrawals (branch_id, shift_id, tank_id, product_id, occurred_at, liters)
WITH (security_invoker = true) AS
SELECT s.branch_id, s.id, n.tank_id, t.product_id, s.closed_at,
       SUM(GREATEST(r.close_meter - r.open_meter, 0))
FROM pos.shifts s
JOIN pos.shift_readings r ON r.shift_id = s.id AND r.branch_id = s.branch_id
JOIN pos.nozzles n ON n.id = r.nozzle_id AND n.branch_id = s.branch_id
JOIN pos.fuel_tanks t ON t.id = n.tank_id AND t.branch_id = s.branch_id
WHERE s.status = 'closed' AND s.closed_at IS NOT NULL AND r.close_meter > r.open_meter
  AND NOT EXISTS (
    SELECT 1 FROM pos.audit_logs a WHERE a.branch_id = s.branch_id
      AND a.ref_type = 'shift' AND a.ref_id = s.id AND a.action = 'create_shift_history'
  )
GROUP BY s.branch_id, s.id, n.tank_id, t.product_id, s.closed_at;
REVOKE ALL ON pos.legacy_tank_withdrawals FROM anon, authenticated;
INSERT INTO pos.tank_withdrawals SELECT * FROM pos.legacy_tank_withdrawals;

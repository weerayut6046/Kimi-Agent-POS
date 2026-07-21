import Database from "better-sqlite3";

const sourcePath = process.argv[2] || "data/pos.db";
const sqlite = new Database(sourcePath, { readonly: true, fileMustExist: true });

const tables = [
  "staff_users",
  "work_shift_templates",
  "products",
  "pumps",
  "members",
  "rewards",
  "customers",
  "settings",
  "shifts",
  "employee_profiles",
  "payroll_records",
  "work_schedules",
  "fuel_tanks",
  "nozzles",
  "shift_readings",
  "sales",
  "sale_items",
  "point_transactions",
  "reward_redemptions",
  "tank_refills",
  "tax_invoices",
  "debt_payments",
  "expenses",
  "price_changes",
  "audit_logs",
];

const timestampColumns = new Set([
  "staff_users.created_at",
  "work_schedules.created_at",
  "payroll_records.paid_at",
  "payroll_records.created_at",
  "products.created_at",
  "shifts.opened_at",
  "shifts.closed_at",
  "sales.created_at",
  "members.created_at",
  "point_transactions.created_at",
  "reward_redemptions.created_at",
  "tank_refills.created_at",
  "customers.created_at",
  "tax_invoices.created_at",
  "debt_payments.created_at",
  "expenses.created_at",
  "price_changes.created_at",
  "audit_logs.created_at",
]);

const booleanColumns = new Set([
  "staff_users.active",
  "work_shift_templates.active",
  "products.active",
  "pumps.active",
  "nozzles.active",
  "rewards.active",
]);

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function literal(table, column, value) {
  if (value == null) return "NULL";
  const key = `${table}.${column}`;
  if (timestampColumns.has(key)) {
    const date = value instanceof Date ? value : new Date(Number(value));
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp in ${key}: ${value}`);
    }
    return `'${date.toISOString()}'::timestamptz`;
  }
  if (booleanColumns.has(key)) return Number(value) === 0 ? "false" : "true";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid number in ${key}`);
    return String(value);
  }
  if (Buffer.isBuffer(value)) return `'\\x${value.toString("hex")}'::bytea`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

const integrity = sqlite.pragma("integrity_check", { simple: true });
if (integrity !== "ok") throw new Error(`SQLite integrity_check failed: ${integrity}`);
const foreignKeyErrors = sqlite.pragma("foreign_key_check");
if (foreignKeyErrors.length > 0) {
  throw new Error(`SQLite foreign_key_check found ${foreignKeyErrors.length} error(s)`);
}

const saleIds = new Set(sqlite.prepare("select id from sales").all().map(row => row.id));
let repairedPointSaleLinks = 0;
const exported = new Map();

for (const table of tables) {
  const columnInfo = sqlite
    .prepare(`pragma table_info(${quoteIdentifier(table)})`)
    .all();
  const columns = columnInfo.map(column => column.name);
  const primaryKeyColumns = columnInfo
    .filter(column => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map(column => column.name);
  const rows = sqlite.prepare(`select * from ${quoteIdentifier(table)} order by rowid`).all();
  if (table === "point_transactions") {
    for (const row of rows) {
      if (row.sale_id != null && !saleIds.has(row.sale_id)) {
        row.sale_id = null;
        repairedPointSaleLinks += 1;
      }
    }
  }
  exported.set(table, { columns, primaryKeyColumns, rows });
}

const statements = [];
const nonEmptyChecks = tables
  .map(table => `SELECT 1 FROM "pos".${quoteIdentifier(table)}`)
  .join(" UNION ALL ");
statements.push(
  `DO $$ BEGIN IF EXISTS (${nonEmptyChecks}) THEN RAISE EXCEPTION 'Target pos schema is not empty'; END IF; END $$;`,
);

for (const table of tables) {
  const { columns, primaryKeyColumns, rows } = exported.get(table);
  if (rows.length === 0) continue;
  const columnSql = columns.map(quoteIdentifier).join(", ");
  for (const row of rows) {
    const largeTextColumns = columns.filter(
      column => typeof row[column] === "string" && row[column].length > 8_000,
    );
    const valuesSql = columns.map(column =>
      largeTextColumns.includes(column) ? "''" : literal(table, column, row[column]),
    );
    statements.push(
      `INSERT INTO "pos".${quoteIdentifier(table)} (${columnSql}) VALUES (${valuesSql.join(", ")});`,
    );

    if (largeTextColumns.length > 0 && primaryKeyColumns.length === 0) {
      throw new Error(`Cannot chunk large text for ${table}: table has no primary key`);
    }
    const whereSql = primaryKeyColumns
      .map(column => `${quoteIdentifier(column)} = ${literal(table, column, row[column])}`)
      .join(" AND ");
    for (const column of largeTextColumns) {
      const value = row[column];
      for (let offset = 0; offset < value.length; offset += 6_000) {
        const segment = value.slice(offset, offset + 6_000);
        statements.push(
          `UPDATE "pos".${quoteIdentifier(table)} SET ${quoteIdentifier(column)} = ${quoteIdentifier(column)} || ${literal(table, column, segment)} WHERE ${whereSql};`,
        );
      }
    }
  }
}

for (const table of tables) {
  const { columns, rows } = exported.get(table);
  if (!columns.includes("id")) continue;
  const hasRows = rows.length > 0 ? "true" : "false";
  statements.push(
    `SELECT setval(pg_get_serial_sequence('pos.${table}', 'id'), COALESCE((SELECT max(id) FROM "pos".${quoteIdentifier(table)}), 1), ${hasRows});`,
  );
}

const assertion = ["DO $$", "DECLARE actual_count bigint;", "BEGIN"];
for (const table of tables) {
  const expected = exported.get(table).rows.length;
  assertion.push(
    `  SELECT count(*) INTO actual_count FROM "pos".${quoteIdentifier(table)};`,
    `  IF actual_count <> ${expected} THEN RAISE EXCEPTION 'Row count mismatch for ${table}: expected ${expected}, got %', actual_count; END IF;`,
  );
}
assertion.push("END", "$$;");
statements.push(assertion.join("\n"));

const summary = `-- Exported ${tables.length} tables from ${sourcePath}; normalized ${repairedPointSaleLinks} orphan point_transactions.sale_id link(s).`;
const transactionSql = body =>
  `${summary}\nBEGIN;\nSET LOCAL statement_timeout = '120s';\n${body.join("\n")}\nCOMMIT;`;

const chunks = [];
let currentChunk = [];
let currentLength = 0;
for (const statement of statements) {
  if (statement.length > 24_000) {
    throw new Error(`Generated statement is too large to transport safely (${statement.length} chars)`);
  }
  if (currentChunk.length > 0 && currentLength + statement.length + 1 > 24_000) {
    chunks.push(transactionSql(currentChunk));
    currentChunk = [];
    currentLength = 0;
  }
  currentChunk.push(statement);
  currentLength += statement.length + 1;
}
if (currentChunk.length > 0) chunks.push(transactionSql(currentChunk));

if (process.argv.includes("--chunk-count")) {
  process.stdout.write(String(chunks.length));
} else if (process.argv.includes("--chunk")) {
  const index = Number(process.argv[process.argv.indexOf("--chunk") + 1]);
  if (!Number.isInteger(index) || index < 0 || index >= chunks.length) {
    throw new Error(`Invalid chunk index ${index}; expected 0..${chunks.length - 1}`);
  }
  process.stdout.write(chunks[index]);
} else {
  process.stdout.write(transactionSql(statements));
}

sqlite.close();

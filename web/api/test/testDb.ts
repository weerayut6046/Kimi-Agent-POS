import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

/**
 * ตั้ง PostgreSQL แบบ in-memory สำหรับ integration test ด้วย PGlite
 * ต้องตั้ง DATABASE_URL ก่อน import โมดูลฝั่ง API — env.ts อ่านค่าตอนโหลดโมดูล
 * และ connection.ts เก็บ singleton จึง dynamic import หลังตั้ง env เสมอ
 */
export async function setupTestDb() {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  process.env.APP_ID = "pos-test";
  process.env.APP_SECRET = "test-only-session-secret-at-least-32-bytes";

  const pg = new PGlite();
  const fullSchema = { ...schema, ...relations };
  const testDb = drizzle({ client: pg, schema: fullSchema });
  const { getDb, resetDb, setDbForTests } =
    await import("../queries/connection");
  setDbForTests(testDb as unknown as ReturnType<typeof getDb>, async () =>
    pg.close()
  );

  // Supabase roles do not exist in a bare PGlite instance, so create them before
  // applying the same migration used in production.
  await pg.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;");
  const migrationDir = fileURLToPath(
    new URL("../../db/migrations-postgres/", import.meta.url)
  );
  const migrations = fs
    .readdirSync(migrationDir)
    .filter(file => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    await pg.exec(fs.readFileSync(path.join(migrationDir, migration), "utf8"));
  }

  const { seedIfEmpty } = await import("../../db/seedCore");
  const { appRouter } = await import("../router");
  const { issueStaffSession } = await import("../lib/session");

  const db = getDb();
  await seedIfEmpty();

  /** สร้าง tRPC caller พร้อม session ที่เซ็นลายเซ็นเหมือน production */
  const caller = (
    role: "admin" | "manager" | "cashier" = "cashier",
    staffId?: number
  ) =>
    appRouter.createCaller({
      req: new Request("http://test.local/api", {
        headers: {
          "x-staff-session": issueStaffSession({
            id:
              staffId ??
              (role === "admin" ? 1 : role === "manager" ? 2 : 3),
            name:
              role === "admin"
                ? "เจ้าของปั๊ม"
                : role === "manager"
                  ? "สมหญิง (ผู้จัดการสาขา)"
                  : "สมชาย (พนักงาน)",
            role,
            username: role === "cashier" ? "somchai" : role,
          }),
        },
      }),
      resHeaders: new Headers(),
    });

  const anonymousCaller = () =>
    appRouter.createCaller({
      req: new Request("http://test.local/api"),
      resHeaders: new Headers(),
    });

  const cleanup = () => resetDb();

  return { db, caller, anonymousCaller, cleanup };
}

export type TestDb = Awaited<ReturnType<typeof setupTestDb>>;

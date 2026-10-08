import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let pg: PGlite | undefined;
afterEach(async () => {
  await pg?.close();
  pg = undefined;
});

describe("retire face profiles", () => {
  it.each(["supabase", "drizzle"])(
    "%s migration removes templates while preserving accounts and attendance history",
    async source => {
      pg = new PGlite();
      await pg.exec(
        "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"
      );
      const directory = fileURLToPath(
        new URL("./migrations-postgres/", import.meta.url)
      );
      for (const migration of fs
        .readdirSync(directory)
        .filter(file => file.endsWith(".sql") && file < "0034_")
        .sort()) {
        await pg.exec(fs.readFileSync(path.join(directory, migration), "utf8"));
      }
      await pg.exec(`
        insert into pos.staff_users (username, pin, name, role, menu_permissions, passkey_user_handle)
        values ('keep-staff', 'existing-pin-hash', 'Existing Staff', 'admin', '["pos", "workforce", "settings"]'::jsonb, 'keep-handle');
        insert into pos.employee_face_profiles
          (staff_id, template_encrypted, embedding_count, embedding_dimensions, consent_at, enrolled_by_staff_id)
        select id, 'old-encrypted-template', 3, 128, now(), id from pos.staff_users where username = 'keep-staff';
        insert into pos.passkey_credentials (id, staff_id, public_key, counter)
        select 'keep-passkey', id, 'AQID', 7 from pos.staff_users where username = 'keep-staff';
        insert into pos.attendance_sessions (staff_id, work_date, clock_in_at, clock_in_method, clock_out_at, clock_out_method, status)
        select id, '2026-09-21', '2026-09-21T01:00:00Z', 'face', '2026-09-21T09:00:00Z', 'face', 'completed'
        from pos.staff_users where username = 'keep-staff';
        insert into pos.attendance_events (staff_id, session_id, event_type, method, idempotency_key)
        select staff_id, id, 'clock_in', 'face', 'keep-historical-event' from pos.attendance_sessions;
      `);
      const accountSql =
        "select * from pos.staff_users where username = 'keep-staff'";
      const sessionSql = "select * from pos.attendance_sessions order by id";
      const eventSql = "select * from pos.attendance_events order by id";
      const credentialSql = "select * from pos.passkey_credentials order by id";
      const before = await Promise.all(
        [accountSql, sessionSql, eventSql, credentialSql].map(sql =>
          pg!.query(sql)
        )
      );
      const migrationDirectory =
        source === "drizzle"
          ? directory
          : fileURLToPath(
              new URL("../../supabase/migrations/", import.meta.url)
            );
      const migrationName = fs
        .readdirSync(migrationDirectory)
        .find(file =>
          source === "drizzle"
            ? file.startsWith("0034_") && file.endsWith(".sql")
            : file.endsWith("_remove_employee_face_profiles.sql")
        );
      expect(migrationName).toBeDefined();
      const sql = fs.readFileSync(
        path.join(migrationDirectory, migrationName!),
        "utf8"
      );
      await pg.exec(sql);
      await pg.exec(sql);
      expect(
        (
          await pg.query(
            "select to_regclass('pos.employee_face_profiles') as table_name"
          )
        ).rows
      ).toEqual([{ table_name: null }]);
      const after = await Promise.all(
        [accountSql, sessionSql, eventSql, credentialSql].map(query =>
          pg!.query(query)
        )
      );
      expect(after.map(result => result.rows)).toEqual(
        before.map(result => result.rows)
      );
      expect(
        (
          await pg.query(`
        select relrowsecurity,
          has_table_privilege('anon', c.oid, 'SELECT') as anon_can_read,
          has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_read
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'pos' and c.relname = 'passkey_credentials'
      `)
        ).rows
      ).toEqual([
        {
          relrowsecurity: true,
          anon_can_read: false,
          authenticated_can_read: false,
        },
      ]);
    }
  );
});

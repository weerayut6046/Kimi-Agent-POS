import fs from "fs";
import path from "path";
import { z } from "zod";
import { format } from "date-fns";
import { createRouter, publicQuery } from "../middleware";
import { adminQuery } from "../guard";
import { getDbPath, resetDb } from "../queries/connection";
import { actorFromReq, logAudit } from "../lib/audit";
import { backupsDir, makeBackup } from "../lib/backup";

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");

/** รับเฉพาะชื่อไฟล์ .db ธรรมดา (กัน path traversal) */
function safeBackupPath(fileName: string) {
  const base = path.basename(fileName);
  if (base !== fileName || !base.endsWith(".db")) throw new Error("ชื่อไฟล์ไม่ถูกต้อง");
  const full = path.join(backupsDir(), base);
  if (!fs.existsSync(full)) throw new Error("ไม่พบไฟล์สำรอง");
  return full;
}

function isSqliteFile(full: string) {
  const fd = fs.openSync(full, "r");
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    return head.equals(SQLITE_MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

/** แทนที่ไฟล์ฐานข้อมูลปัจจุบันด้วยไฟล์สำรอง (ปิด connection ก่อน แล้วเปิดใหม่อัตโนมัติ) */
async function doRestore(backupFull: string) {
  if (!isSqliteFile(backupFull)) throw new Error("ไฟล์ที่เลือกไม่ใช่ฐานข้อมูล SQLite");
  // สำรองของเดิมไว้ก่อนเผื่อกู้ผิด
  await makeBackup("pos-pre-restore");

  const dbPath = getDbPath();
  resetDb();
  // connection ปิดแล้ว SQLite จะ checkpoint ลบ -wal/-shm ให้ แต่กันเหนียวลบทิ้งอีกครั้ง
  for (const suffix of ["-wal", "-shm"]) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
  fs.copyFileSync(backupFull, dbPath);
}

export const dbadminRouter = createRouter({
  // ---------- ข้อมูลฐานข้อมูล + รายการสำรอง ----------
  dbInfo: publicQuery.query(() => {
    const dbPath = getDbPath();
    const sizeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const backups = fs
      .readdirSync(backupsDir())
      .filter((f) => f.endsWith(".db"))
      .map((name) => {
        const st = fs.statSync(path.join(backupsDir(), name));
        return { name, sizeBytes: st.size, modifiedAt: st.mtime };
      })
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return { dbPath, sizeBytes, backups };
  }),

  // ---------- สำรองตอนนี้ ----------
  backup: adminQuery.mutation(async () => {
    // makeBackup คืน path เต็ม — หน้าเว็บใช้แค่ชื่อไฟล์เหมือนเดิม
    const name = path.basename(await makeBackup("pos-backup"));
    return { ok: true, name };
  }),

  // ---------- กู้คืนจากไฟล์สำรองในเครื่อง ----------
  restore: adminQuery
    .input(z.object({ fileName: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      // อ่าน actor ก่อน restore — restore จะสลับไปใช้ไฟล์ฐานข้อมูลใหม่
      const actor = actorFromReq(ctx.req);
      await doRestore(safeBackupPath(input.fileName));
      logAudit({ action: "restore_db", ...actor, detail: `กู้คืนฐานข้อมูลจากไฟล์สำรอง ${input.fileName}` });
      return { ok: true };
    }),

  // ---------- ลบไฟล์สำรอง ----------
  deleteBackup: adminQuery
    .input(z.object({ fileName: z.string().min(1) }))
    .mutation(({ input }) => {
      fs.rmSync(safeBackupPath(input.fileName));
      return { ok: true };
    }),

  // ---------- อ่านไฟล์สำรอง (ดาวน์โหลดผ่าน browser) ----------
  readBackup: adminQuery.input(z.object({ fileName: z.string().min(1) })).query(({ input }) => {
    const full = safeBackupPath(input.fileName);
    return { fileName: path.basename(full), contentBase64: fs.readFileSync(full).toString("base64") };
  }),

  // ---------- อัปโหลดไฟล์ .db จากเครื่องอื่นมากู้คืน ----------
  restoreUpload: adminQuery
    .input(z.object({ fileName: z.string().min(1), contentBase64: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const buf = Buffer.from(input.contentBase64, "base64");
      if (buf.length < 100 || !buf.subarray(0, 16).equals(SQLITE_MAGIC)) {
        throw new Error("ไฟล์ที่อัปโหลดไม่ใช่ฐานข้อมูล SQLite");
      }
      const actor = actorFromReq(ctx.req); // อ่านก่อน restore — restore จะสลับไฟล์ฐานข้อมูล
      const upName = `pos-upload-${format(new Date(), "yyyyMMdd-HHmmss")}.db`;
      const upFull = path.join(backupsDir(), upName);
      fs.writeFileSync(upFull, buf);
      await doRestore(upFull);
      logAudit({ action: "restore_upload", ...actor, detail: `กู้คืนฐานข้อมูลจากไฟล์อัปโหลด ${input.fileName}` });
      return { ok: true, name: upName };
    }),
});

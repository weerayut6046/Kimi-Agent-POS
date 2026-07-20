// updater.ts — อัปเดตแอปอัตโนมัติผ่าน electron-updater + Google Cloud Storage (generic provider)
// ใช้เฉพาะแอปที่ติดตั้งผ่าน NSIS เท่านั้น (portable .exe อัปเดตตัวเองไม่ได้ — main.ts guard ไว้แล้ว)
// UX ทั้งหมดเป็น native dialog จาก main process: ถามก่อนดาวน์โหลด (เน็ตปั๊มอาจช้า) และถามก่อนรีสตาร์ท
import { app, dialog, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "fs";
import path from "path";

// logger เขียนลงไฟล์ %APPDATA%/pos-app/logs/update.log — ไว้ดีบักหน้างาน (error เงียบต่อผู้ใช้)
const logFile = () => path.join(app.getPath("userData"), "logs", "update.log");
function writeLog(level: string, args: unknown[]) {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    const line = `[${new Date().toISOString()}] [${level}] ${args
      .map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a)))
      .join(" ")}\n`;
    fs.appendFileSync(logFile(), line, "utf8");
  } catch {
    // เขียน log ไม่ได้ก็ช่าง — อย่าให้กระทบการอัปเดต
  }
}
const fileLogger = {
  info: (...a: unknown[]) => writeLog("info", a),
  warn: (...a: unknown[]) => writeLog("warn", a),
  error: (...a: unknown[]) => writeLog("error", a),
  debug: (...a: unknown[]) => writeLog("debug", a),
};

export function setupAutoUpdater(getWindow: () => BrowserWindow | undefined) {
  autoUpdater.logger = fileLogger;
  autoUpdater.autoDownload = false; // ถามผู้ใช้ก่อนดาวน์โหลด (ไฟล์ ~100 MB)
  autoUpdater.autoInstallOnAppQuit = true; // ถ้าเลือก "ติดตั้งตอนปิดแอป"

  autoUpdater.on("update-available", async (info) => {
    fileLogger.info("พบเวอร์ชันใหม่", info.version);
    const win = getWindow();
    const r = await dialog.showMessageBox(win!, {
      type: "info",
      title: "มีอัปเดตใหม่",
      message: `พบเวอร์ชันใหม่ ${info.version} (ปัจจุบัน ${app.getVersion()})`,
      detail: "ดาวน์โหลดตอนนี้เลยไหม (ประมาณ 100 MB)? ระบบจะโหลดในพื้นหลัง ใช้งานต่อได้ปกติ",
      buttons: ["ดาวน์โหลด", "ไว้ทีหลัง"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response === 0) {
      autoUpdater.downloadUpdate().catch((err) => fileLogger.error("ดาวน์โหลดอัปเดตล้มเหลว", err));
    } else {
      fileLogger.info("ผู้ใช้เลือกข้ามการดาวน์โหลดเวอร์ชัน", info.version);
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    fileLogger.info("เป็นเวอร์ชันล่าสุดแล้ว", info.version);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    fileLogger.info("ดาวน์โหลดเสร็จ", info.version);
    const win = getWindow();
    const r = await dialog.showMessageBox(win!, {
      type: "info",
      title: "อัปเดตพร้อมติดตั้ง",
      message: `ดาวน์โหลดเวอร์ชัน ${info.version} เสร็จแล้ว`,
      detail: "รีสตาร์ทเพื่อติดตั้งตอนนี้เลยไหม (ถ้าไม่ ระบบจะติดตั้งอัตโนมัติตอนปิดแอป)",
      buttons: ["รีสตาร์ทตอนนี้", "ติดตั้งตอนปิดแอป"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (err) => {
    // เงียบต่อผู้ใช้ — เช่น เน็ตหลุด/ไม่มีอินเทอร์เน็ตที่ปั๊ม ไม่ควรมี popup รบกวน
    fileLogger.error("อัปเดตผิดพลาด", err);
  });

  // เช็กครั้งแรกหลังเปิดแอปสักครู่ (รอ server+หน้าต่างพร้อมก่อน)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => fileLogger.error("เช็กอัปเดตล้มเหลว", err));
  }, 10_000);
}

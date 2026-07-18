import { app, BrowserWindow, dialog } from "electron";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// main ถูก bundle เป็น CJS (dist/electron/main.cjs) — runtime มี __dirname ให้
// (import 'electron' ใน CJS คืน API object เต็มรูปแบบเสมอ ต่างจาก ESM ที่มีข้อจำกัด)
declare const __dirname: string;

const isPackaged = app.isPackaged;
const DEV_URL = process.env.ELECTRON_START_URL || "http://localhost:3000";
const PORT = process.env.PORT || "3210";

// ชื่อโฟลเดอร์ userData ให้เป็น ASCII คงที่ (%APPDATA%/pos-app)
// กันปัญหา path ภาษาไทย/ช่องว่างของ productName
app.setName("pos-app");

/**
 * ตั้งค่า environment ให้ server bundle ก่อน import เสมอ
 * (api/lib/env.ts อ่าน process.env ตอนโหลดโมดูล)
 */
function setupEnv() {
  const dataDir = app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true });

  process.env.NODE_ENV = "production";
  process.env.PORT = PORT;
  process.env.APP_ID ||= "pos-desktop";

  // APP_SECRET: สุ่มครั้งแรกแล้วเก็บถาวรใน userData
  if (!process.env.APP_SECRET) {
    const secretFile = path.join(dataDir, ".app-secret");
    if (fs.existsSync(secretFile)) {
      process.env.APP_SECRET = fs.readFileSync(secretFile, "utf8").trim();
    } else {
      const secret = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(secretFile, secret, "utf8");
      process.env.APP_SECRET = secret;
    }
  }

  process.env.DATABASE_URL ||= path.join(dataDir, "pos.db");
  process.env.POS_STATIC_DIR ||= path.resolve(__dirname, "../public");
}

/** migrate + seed (ถ้ายังว่าง) + สตาร์ท Hono/tRPC server (serve statics เองตอน production) */
async function startServer() {
  const { getDb } = await import("../../web/api/queries/connection");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  migrate(getDb(), { migrationsFolder: path.resolve(__dirname, "../migrations") });

  const { seedIfEmpty } = await import("../../web/db/seedCore");
  await seedIfEmpty();

  await import("../../web/api/boot");
}

function createWindow(url: string) {
  const win = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    title: "POS ปั๊มน้ำมัน",
  });
  win.loadURL(url);
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    if (!isPackaged) {
      // dev: frontend + API รันอยู่ที่ vite dev server (npm run dev)
      createWindow(DEV_URL);
    } else {
      try {
        setupEnv();
        await startServer();
        createWindow(`http://127.0.0.1:${PORT}`);
      } catch (err) {
        dialog.showErrorBox(
          "เริ่มระบบไม่สำเร็จ",
          String(err instanceof Error ? (err.stack ?? err.message) : err),
        );
        app.quit();
      }
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(isPackaged ? `http://127.0.0.1:${PORT}` : DEV_URL);
      }
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}

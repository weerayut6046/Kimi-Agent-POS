import { app, BrowserWindow, dialog, ipcMain } from "electron";
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

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");

function defaultDbPath() {
  return path.join(app.getPath("userData"), "pos.db");
}

// ---------- config.json (ตำแหน่งไฟล์ฐานข้อมูลที่ผู้ใช้เลือกเอง) ----------
type AppConfig = { dbPath?: string };
const configFile = () => path.join(app.getPath("userData"), "config.json");
function readConfig(): AppConfig {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8")) as AppConfig;
  } catch {
    return {};
  }
}
function writeConfig(cfg: AppConfig) {
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), "utf8");
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

/** IPC ให้ renderer (ผ่าน preload → window.posDesktop) */
function registerIpc() {
  ipcMain.handle("app:version", () => app.getVersion());

  ipcMain.handle("dbconfig:get", () => ({
    dbPath: readConfig().dbPath ?? defaultDbPath(),
    defaultPath: defaultDbPath(),
  }));

  // mode "open" = ใช้ไฟล์ฐานข้อมูลเดิมที่มีอยู่, "save" = สร้างไฟล์ไว้ตำแหน่งใหม่
  ipcMain.handle("dbconfig:choose", async (event, mode: "open" | "save") => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const filters = [{ name: "SQLite Database", extensions: ["db", "sqlite", "sqlite3"] }];

    if (mode === "open") {
      const r = await dialog.showOpenDialog(win!, { title: "เลือกไฟล์ฐานข้อมูลเดิม", filters, properties: ["openFile"] });
      if (r.canceled || !r.filePaths[0]) return { changed: false };
      const chosen = r.filePaths[0];
      if (!isSqliteFile(chosen)) return { changed: false, error: "ไฟล์ที่เลือกไม่ใช่ฐานข้อมูล SQLite" };
      writeConfig({ dbPath: chosen });
    } else {
      const r = await dialog.showSaveDialog(win!, { title: "สร้างไฟล์ฐานข้อมูลไว้ที่...", defaultPath: "pos.db", filters });
      if (r.canceled || !r.filePath) return { changed: false };
      let chosen = r.filePath;
      if (!/\.(db|sqlite|sqlite3)$/i.test(chosen)) chosen += ".db";
      writeConfig({ dbPath: chosen });
    }
    // เปลี่ยนตำแหน่งแล้วต้องรีสตาร์ทเพื่อให้ server เปิดไฟล์ใหม่
    app.relaunch();
    app.exit(0);
  });
}

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

  // ตำแหน่งฐานข้อมูล: env > config.json (ผู้ใช้เลือกเอง) > default userData/pos.db
  process.env.DATABASE_URL ||= readConfig().dbPath ?? defaultDbPath();
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
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
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
    registerIpc();

    if (!isPackaged) {
      // dev: frontend + API รันอยู่ที่ vite dev server (npm run dev)
      createWindow(DEV_URL);
    } else {
      try {
        setupEnv();
        await startServer();
        createWindow(`http://127.0.0.1:${PORT}`);
        // อัปเดตอัตโนมัติเฉพาะติดตั้งผ่าน NSIS — portable .exe อัปเดตตัวเองไม่ได้
        // (dynamic import เพื่อไม่ให้ dev โหลด electron-updater)
        if (!process.env.PORTABLE_EXECUTABLE_FILE) {
          const { setupAutoUpdater } = await import("./updater");
          setupAutoUpdater(() => BrowserWindow.getAllWindows()[0]);
        }
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

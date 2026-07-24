import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import path from "path";
import { fitWindowToWorkArea } from "../windowBounds";
import { DesktopOfflineRuntime } from "./offlineRuntime";
import { shouldStartLegacyUpdater } from "./updatePolicy";
import type { DesktopSaleRequest } from "../../web/contracts/offline";

declare const __dirname: string;

const isPackaged = app.isPackaged;
const DEV_URL = process.env.ELECTRON_START_URL || "http://localhost:3000";
const PROD_API_ORIGIN =
  process.env.POS_API_ORIGIN || "https://kimi-agent-pos.vercel.app";

app.setName("pos-app");

let desktopUrl = DEV_URL;
let offlineRuntime: DesktopOfflineRuntime | null = null;

function registerIpc(runtime: DesktopOfflineRuntime) {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("offline:status", () => runtime.getStatus());
  ipcMain.handle("offline:retry", () => runtime.retrySync());
  ipcMain.handle(
    "sale:create-offline-capable",
    (_event, request: DesktopSaleRequest) => runtime.createSale(request)
  );

  ipcMain.handle(
    "print:silent",
    async (
      _event,
      payload: { html: string; widthUm: number; heightUm: number }
    ) => {
      const win = new BrowserWindow({ show: false, width: 800, height: 600 });
      try {
        await win.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(payload.html)}`
        );
        await new Promise<void>((resolve, reject) => {
          win.webContents.print(
            {
              silent: true,
              printBackground: true,
              margins: { marginType: "none" },
              pageSize: { width: payload.widthUm, height: payload.heightUm },
            },
            (ok, reason) =>
              ok ? resolve() : reject(new Error(reason || "พิมพ์ไม่สำเร็จ"))
          );
        });
        return { ok: true };
      } finally {
        win.destroy();
      }
    }
  );
}

function createWindow(url: string) {
  const bounds = fitWindowToWorkArea(screen.getPrimaryDisplay().workAreaSize);
  const win = new BrowserWindow({
    ...bounds,
    center: true,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    title: "POS ปั๊มน้ำมัน",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    try {
      const parsed = new URL(targetUrl);
      if (
        parsed.protocol === "https:" &&
        (parsed.hostname === "supabase.com" ||
          parsed.hostname.endsWith(".supabase.com"))
      ) {
        void shell.openExternal(targetUrl);
      }
    } catch {
      // URL ที่ไม่ถูกต้องหรือไม่อยู่ใน allowlist จะถูกปฏิเสธด้านล่าง
    }
    return { action: "deny" };
  });
  void win.loadURL(url);
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
    try {
      offlineRuntime = new DesktopOfflineRuntime({
        dataDir: isPackaged
          ? app.getPath("userData")
          : path.join(app.getPath("userData"), "dev-offline"),
        staticDir: path.resolve(__dirname, "../public"),
        remoteOrigin: isPackaged ? PROD_API_ORIGIN : new URL(DEV_URL).origin,
        onStatus: status => {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send("offline:status", status);
          }
        },
      });
      const localUrl = await offlineRuntime.start();
      desktopUrl = isPackaged ? localUrl : DEV_URL;
      registerIpc(offlineRuntime);
      createWindow(desktopUrl);
    } catch (error) {
      dialog.showErrorBox(
        "เริ่มระบบ Offline ไม่สำเร็จ",
        String(error instanceof Error ? (error.stack ?? error.message) : error)
      );
      app.quit();
      return;
    }

    if (
      shouldStartLegacyUpdater({
        isPackaged,
        isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
        isWindowsStore: process.windowsStore === true,
      })
    ) {
      const { setupAutoUpdater } = await import("./updater");
      setupAutoUpdater(() => BrowserWindow.getAllWindows()[0]);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(desktopUrl);
      }
    });
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => offlineRuntime?.stop());
}

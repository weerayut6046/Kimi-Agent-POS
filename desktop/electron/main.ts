import { app, BrowserWindow, ipcMain, screen, shell } from "electron";
import path from "path";
import { fitWindowToWorkArea } from "../windowBounds";

declare const __dirname: string;

const isPackaged = app.isPackaged;
const DEV_URL = process.env.ELECTRON_START_URL || "http://localhost:3000";
const PROD_URL = process.env.POS_WEB_URL || "https://kimi-agent-pos.vercel.app";

app.setName("pos-app");

function registerIpc() {
  ipcMain.handle("app:version", () => app.getVersion());

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
    registerIpc();
    createWindow(isPackaged ? PROD_URL : DEV_URL);

    if (isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE) {
      const { setupAutoUpdater } = await import("./updater");
      setupAutoUpdater(() => BrowserWindow.getAllWindows()[0]);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(isPackaged ? PROD_URL : DEV_URL);
      }
    });
  });

  app.on("window-all-closed", () => app.quit());
}

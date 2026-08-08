import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  screen,
  shell,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron";
import fs from "node:fs";
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
let allowPendingSalesClose = false;
let pendingSalesClosePromptOpen = false;

const OFFLINE_RECOVERY_MAGIC = Buffer.from(
  "PUMPPOS-OFFLINE-RECOVERY-V1\n",
  "utf8"
);

function recoveryFileName(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `pos-offline-recovery-${stamp}.posbackup`;
}

function requireRecoveryEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Windows ยังไม่พร้อมเข้ารหัสไฟล์กู้ภัย กรุณาเข้าสู่ระบบ Windows แล้วลองใหม่"
    );
  }
}

async function exportOfflineRecovery(
  runtime: DesktopOfflineRuntime,
  parent?: BrowserWindow
) {
  requireRecoveryEncryption();
  const snapshot = runtime.createRecoverySnapshot();
  const encrypted = safeStorage.encryptString(snapshot);
  const options: SaveDialogOptions = {
    title: "บันทึกไฟล์กู้ภัยบิลออฟไลน์",
    defaultPath: path.join(app.getPath("documents"), recoveryFileName()),
    filters: [{ name: "POS Offline Recovery", extensions: ["posbackup"] }],
  };
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return {
      canceled: true,
      fileName: null,
      pendingCount: runtime.getStatus().pendingCount,
      importedCount: 0,
    };
  }
  await fs.promises.writeFile(
    result.filePath,
    Buffer.concat([OFFLINE_RECOVERY_MAGIC, encrypted]),
    { flag: "w" }
  );
  return {
    canceled: false,
    fileName: path.basename(result.filePath),
    pendingCount: runtime.getStatus().pendingCount,
    importedCount: 0,
  };
}

async function importOfflineRecovery(
  runtime: DesktopOfflineRuntime,
  parent?: BrowserWindow
) {
  requireRecoveryEncryption();
  const options: OpenDialogOptions = {
    title: "เลือกไฟล์กู้ภัยบิลออฟไลน์",
    properties: ["openFile"],
    filters: [{ name: "POS Offline Recovery", extensions: ["posbackup"] }],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  const filePath = result.filePaths[0];
  if (result.canceled || !filePath) {
    return {
      canceled: true,
      fileName: null,
      pendingCount: runtime.getStatus().pendingCount,
      importedCount: 0,
    };
  }
  const file = await fs.promises.readFile(filePath);
  if (file.length > 50 * 1024 * 1024) {
    throw new Error("ไฟล์กู้ภัยมีขนาดเกิน 50 MB");
  }
  if (
    file.length <= OFFLINE_RECOVERY_MAGIC.length ||
    !file
      .subarray(0, OFFLINE_RECOVERY_MAGIC.length)
      .equals(OFFLINE_RECOVERY_MAGIC)
  ) {
    throw new Error("ไฟล์ที่เลือกไม่ใช่ไฟล์กู้ภัยของ POS หรือไฟล์เสียหาย");
  }
  const snapshot = safeStorage.decryptString(
    file.subarray(OFFLINE_RECOVERY_MAGIC.length)
  );
  const imported = runtime.importRecoverySnapshot(snapshot);
  return {
    canceled: false,
    fileName: path.basename(filePath),
    ...imported,
  };
}

function registerIpc(runtime: DesktopOfflineRuntime) {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("offline:status", () => runtime.getStatus());
  ipcMain.handle("offline:retry", (_event, staffToken?: string) =>
    runtime.retrySync(staffToken)
  );
  ipcMain.handle("offline:recovery-export", event =>
    exportOfflineRecovery(
      runtime,
      BrowserWindow.fromWebContents(event.sender) ?? undefined
    )
  );
  ipcMain.handle("offline:recovery-import", event =>
    importOfflineRecovery(
      runtime,
      BrowserWindow.fromWebContents(event.sender) ?? undefined
    )
  );
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
  win.on("close", event => {
    const pendingCount = offlineRuntime?.getStatus().pendingCount ?? 0;
    if (allowPendingSalesClose || pendingCount === 0) return;
    event.preventDefault();
    if (pendingSalesClosePromptOpen) return;
    pendingSalesClosePromptOpen = true;
    void dialog
      .showMessageBox(win, {
        type: "warning",
        title: "ยังมีบิลรอซิงก์",
        message: `มี ${pendingCount} บิลที่ยังไม่ได้ส่งขึ้นคลาวด์`,
        detail:
          "แนะนำให้กลับไปเชื่อมอินเทอร์เน็ตแล้วซิงก์ หรือส่งออกไฟล์กู้ภัยแบบเข้ารหัสก่อนปิดโปรแกรม ไฟล์เปิดได้ภายใต้บัญชี Windows เดิม และข้อมูลยังคงอยู่ในเครื่องหากเลือกปิดต่อ",
        buttons: [
          "กลับไปซิงก์",
          "ส่งออกไฟล์กู้ภัยแล้วปิด",
          "ปิดและเก็บไว้ในเครื่อง",
        ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(async result => {
        if (result.response === 0) return;
        if (result.response === 1) {
          const exported = await exportOfflineRecovery(offlineRuntime!, win);
          if (exported.canceled) return;
        }
        allowPendingSalesClose = true;
        app.quit();
      })
      .catch(error => {
        void dialog.showMessageBox(win, {
          type: "error",
          title: "ส่งออกไฟล์กู้ภัยไม่สำเร็จ",
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        pendingSalesClosePromptOpen = false;
      });
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

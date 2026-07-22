// updater.ts — อัปเดตแอปอัตโนมัติผ่าน electron-updater + Google Cloud Storage (generic provider)
// ใช้เฉพาะแอปที่ติดตั้งผ่าน NSIS เท่านั้น (portable .exe อัปเดตตัวเองไม่ได้ — main.ts guard ไว้แล้ว)
// ถามก่อนดาวน์โหลด แสดง progress/error ชัดเจน และถามก่อนรีสตาร์ท
import {
  app,
  BrowserWindow,
  dialog,
  shell,
  type MessageBoxOptions,
} from "electron";
import { autoUpdater } from "electron-updater";
import fs from "fs";
import path from "path";
import {
  createDownloadProgressView,
  describeUpdateError,
  DOWNLOAD_PROGRESS_HTML,
  type DownloadProgressView,
} from "./updaterUi";

// logger เขียนลงไฟล์ %APPDATA%/pos-app/logs/update.log — ไว้ดีบักหน้างาน
const logFile = () => path.join(app.getPath("userData"), "logs", "update.log");
function writeLog(level: string, args: unknown[]) {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    const line = `[${new Date().toISOString()}] [${level}] ${args
      .map(a => (a instanceof Error ? (a.stack ?? a.message) : String(a)))
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
  autoUpdater.autoRunAppAfterInstall = true;
  // GCS รองรับ single range แต่ปฏิเสธ multi-range ที่ differential downloader ใช้
  // ปิด differential เพื่อไม่ให้เจอ HTTP 400 ก่อน fallback มาโหลดไฟล์เต็มทุกครั้ง
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.disableWebInstaller = true;

  let downloadInProgress = false;
  let activeVersion = "";
  let progressWindow: BrowserWindow | null = null;
  let lastProgress: DownloadProgressView | null = null;
  let lastLoggedBucket = -1;
  let errorDialogVisible = false;

  const usableMainWindow = () => {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : undefined;
  };

  const showMessage = (options: MessageBoxOptions) => {
    const win = usableMainWindow();
    return win
      ? dialog.showMessageBox(win, options)
      : dialog.showMessageBox(options);
  };

  const renderProgress = () => {
    if (
      !progressWindow ||
      progressWindow.isDestroyed() ||
      progressWindow.webContents.isDestroyed() ||
      !lastProgress
    ) {
      return;
    }
    const state = JSON.stringify({ ...lastProgress, version: activeVersion });
    void progressWindow.webContents
      .executeJavaScript(`window.setDownloadState(${state})`, true)
      .catch(err => fileLogger.warn("อัปเดตหน้าต่าง progress ไม่สำเร็จ", err));
  };

  const closeProgressWindow = () => {
    usableMainWindow()?.setProgressBar(-1);
    const win = progressWindow;
    progressWindow = null;
    lastProgress = null;
    if (win && !win.isDestroyed()) win.destroy();
  };

  const openProgressWindow = () => {
    closeProgressWindow();
    const parent = usableMainWindow();
    const win = new BrowserWindow({
      width: 470,
      height: 245,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      autoHideMenuBar: true,
      backgroundColor: "#f8fafc",
      title: "กำลังดาวน์โหลดอัปเดต",
      ...(parent ? { parent } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    progressWindow = win;
    parent?.setProgressBar(0.01);
    win.setMenuBarVisibility(false);
    win.webContents.once("did-finish-load", renderProgress);
    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) win.show();
    });
    win.on("closed", () => {
      if (progressWindow === win) progressWindow = null;
    });
    void win
      .loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(DOWNLOAD_PROGRESS_HTML)}`
      )
      .catch(err => fileLogger.warn("เปิดหน้าต่าง progress ไม่สำเร็จ", err));
  };

  const showDownloadFailure = async (error: unknown) => {
    if (!downloadInProgress || errorDialogVisible) return;
    downloadInProgress = false;
    closeProgressWindow();
    errorDialogVisible = true;
    let response = 2;
    try {
      const r = await showMessage({
        type: "error",
        title: "ดาวน์โหลดอัปเดตไม่สำเร็จ",
        message: `ไม่สามารถดาวน์โหลดเวอร์ชัน ${activeVersion} ได้`,
        detail: `${describeUpdateError(error)}\n\nคุณยังใช้งานโปรแกรมเวอร์ชันเดิมต่อได้ตามปกติ`,
        buttons: ["ลองใหม่", "ดาวน์โหลดตัวติดตั้ง", "ปิด"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      response = r.response;
    } finally {
      errorDialogVisible = false;
    }
    if (response === 0) {
      void startDownload(activeVersion);
    } else if (response === 1 && activeVersion) {
      const installerUrl = `https://storage.googleapis.com/kimi-agent-pos-updates/POS-Pump-Setup-${encodeURIComponent(activeVersion)}.exe`;
      await shell.openExternal(installerUrl);
    }
  };

  const startDownload = async (version: string) => {
    if (downloadInProgress) {
      if (progressWindow && !progressWindow.isDestroyed()) {
        progressWindow.show();
        progressWindow.focus();
      }
      return;
    }
    activeVersion = version;
    downloadInProgress = true;
    lastLoggedBucket = -1;
    fileLogger.info("เริ่มดาวน์โหลดอัปเดต", version);
    openProgressWindow();
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      fileLogger.error("ดาวน์โหลดอัปเดตล้มเหลว", error);
      await showDownloadFailure(error);
    }
  };

  autoUpdater.on("update-available", async info => {
    fileLogger.info("พบเวอร์ชันใหม่", info.version);
    const r = await showMessage({
      type: "info",
      title: "มีอัปเดตใหม่",
      message: `พบเวอร์ชันใหม่ ${info.version} (ปัจจุบัน ${app.getVersion()})`,
      detail:
        "ดาวน์โหลดตอนนี้เลยไหม (ประมาณ 100 MB)? ระบบจะโหลดในพื้นหลัง ใช้งานต่อได้ปกติ",
      buttons: ["ดาวน์โหลด", "ไว้ทีหลัง"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response === 0) {
      void startDownload(info.version);
    } else {
      fileLogger.info("ผู้ใช้เลือกข้ามการดาวน์โหลดเวอร์ชัน", info.version);
    }
  });

  autoUpdater.on("update-not-available", info => {
    fileLogger.info("เป็นเวอร์ชันล่าสุดแล้ว", info.version);
  });

  autoUpdater.on("download-progress", progress => {
    if (!downloadInProgress) return;
    lastProgress = createDownloadProgressView(progress);
    usableMainWindow()?.setProgressBar(lastProgress.percent / 100);
    renderProgress();

    const bucket = Math.floor(lastProgress.percent / 10) * 10;
    if (bucket !== lastLoggedBucket) {
      lastLoggedBucket = bucket;
      fileLogger.info(
        `ดาวน์โหลด ${lastProgress.percentText}`,
        `${lastProgress.transferredText}/${lastProgress.totalText}`,
        lastProgress.speedText
      );
    }
  });

  autoUpdater.on("update-downloaded", async info => {
    fileLogger.info("ดาวน์โหลดเสร็จ", info.version);
    downloadInProgress = false;
    activeVersion = info.version;
    closeProgressWindow();
    const r = await showMessage({
      type: "info",
      title: "อัปเดตพร้อมติดตั้ง",
      message: `ดาวน์โหลดเวอร์ชัน ${info.version} เสร็จแล้ว`,
      detail:
        "รีสตาร์ทเพื่อติดตั้งตอนนี้เลยไหม? Windows อาจขอสิทธิ์ Administrator (ถ้าเลือกติดตั้งตอนปิดแอป ระบบจะติดตั้งอัตโนมัติเมื่อออกจากโปรแกรม)",
      buttons: ["รีสตาร์ทตอนนี้", "ติดตั้งตอนปิดแอป"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response === 0) {
      fileLogger.info("ผู้ใช้เลือกรีสตาร์ทเพื่อติดตั้ง", info.version);
      autoUpdater.quitAndInstall(false, true);
    } else {
      fileLogger.info("ผู้ใช้เลือกติดตั้งตอนปิดแอป", info.version);
    }
  });

  autoUpdater.on("update-cancelled", info => {
    fileLogger.warn("การดาวน์โหลดถูกยกเลิก", info.version);
    void showDownloadFailure(new Error("การดาวน์โหลดถูกยกเลิก"));
  });

  autoUpdater.on("error", err => {
    fileLogger.error("อัปเดตผิดพลาด", err);
    // ตอนเช็กอัตโนมัติยังคงไม่รบกวนผู้ใช้ แต่ถ้ากดดาวน์โหลดแล้วต้องแจ้งผลและให้ลองใหม่
    if (downloadInProgress) void showDownloadFailure(err);
  });

  // เช็กครั้งแรกหลังเปิดแอปสักครู่ (รอ server+หน้าต่างพร้อมก่อน)
  setTimeout(() => {
    autoUpdater
      .checkForUpdates()
      .catch(err => fileLogger.error("เช็กอัปเดตล้มเหลว", err));
  }, 10_000);
}

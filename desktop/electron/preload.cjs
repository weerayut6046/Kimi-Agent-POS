// preload — เปิดเผย API จำกัดให้ renderer ผ่าน window.posDesktop (contextIsolation ปลอดภัย)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posDesktop", {
  /** เลขเวอร์ชันของแอป (app.getVersion()) — ไว้แสดงหน้า Login ยืนยันผลอัปเดต */
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  /** พิมพ์เงียบเข้าเครื่องพิมพ์ default ของ Windows — ส่ง HTML ใบเสร็จ (render โดย Chromium ไทยถูกเสมอ) + ขนาดกระดาษไมครอน */
  printSilent: (html, page) => ipcRenderer.invoke("print:silent", { html, ...page }),
});

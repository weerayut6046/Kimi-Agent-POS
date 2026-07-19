// preload — เปิดเผย API จำกัดให้ renderer ผ่าน window.posDesktop (contextIsolation ปลอดภัย)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posDesktop", {
  /** คืน { dbPath, defaultPath } — ตำแหน่งไฟล์ฐานข้อมูลปัจจุบันและค่าเริ่มต้น */
  getDbConfig: () => ipcRenderer.invoke("dbconfig:get"),
  /** เลือก/สร้างตำแหน่งฐานข้อมูลใหม่ (mode: "open" | "save") — สำเร็จแล้วแอปจะรีสตาร์ทเอง */
  chooseDbPath: (mode) => ipcRenderer.invoke("dbconfig:choose", mode),
  /** เลขเวอร์ชันของแอป (app.getVersion()) — ไว้แสดงหน้า Login ยืนยันผลอัปเดต */
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  /** พิมพ์เงียบเข้าเครื่องพิมพ์ default ของ Windows — ส่ง HTML ใบเสร็จ (render โดย Chromium ไทยถูกเสมอ) + ขนาดกระดาษไมครอน */
  printSilent: (html, page) => ipcRenderer.invoke("print:silent", { html, ...page }),
});

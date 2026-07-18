// ชนิดของ window.posDesktop ที่ preload ของ desktop app เปิดเผยให้
// (มีเฉพาะตอนรันใน Electron เท่านั้น — browser/docker จะเป็น undefined)
export {};

declare global {
  interface Window {
    posDesktop?: {
      /** คืน { dbPath, defaultPath } — ตำแหน่งไฟล์ฐานข้อมูลปัจจุบันและค่าเริ่มต้น */
      getDbConfig(): Promise<{ dbPath: string; defaultPath: string }>;
      /** เลือก/สร้างตำแหน่งฐานข้อมูลใหม่ — สำเร็จแล้วแอปรีสตาร์ทเอง (promise อาจไม่ resolve เพราะแอปออกก่อน) */
      chooseDbPath(mode: "open" | "save"): Promise<{ changed: boolean; error?: string } | undefined>;
    };
  }
}

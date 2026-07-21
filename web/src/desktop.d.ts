// ชนิดของ window.posDesktop ที่ preload ของ desktop app เปิดเผยให้
// (มีเฉพาะตอนรันใน Electron เท่านั้น — browser/docker จะเป็น undefined)
import type {
  DesktopSaleRequest,
  DesktopSaleResult,
  DesktopSyncStatus,
} from "@contracts/offline";

export {};

declare global {
  interface Window {
    posDesktop?: {
      /** เลขเวอร์ชันของแอป desktop — ไว้แสดงหน้า Login ยืนยันผลอัปเดต */
      getAppVersion(): Promise<string>;
      getSyncStatus(): Promise<DesktopSyncStatus>;
      retrySync(): Promise<DesktopSyncStatus>;
      createSale(request: DesktopSaleRequest): Promise<DesktopSaleResult>;
      onSyncStatus(callback: (status: DesktopSyncStatus) => void): () => void;
      /** พิมพ์เงียบเข้าเครื่องพิมพ์ default ของ Windows (Chromium render — ไทยถูกเสมอ) — html คือเอกสารเต็มพร้อม stylesheet, page ขนาดกระดาษหน่วยไมครอน */
      printSilent(
        html: string,
        page: { widthUm: number; heightUm: number }
      ): Promise<{ ok: boolean }>;
    };
  }
}

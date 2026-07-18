/**
 * ส่ง raw bytes เข้าเครื่องพิมพ์ความร้อน ESC/POS — รองรับ 2 โหมด
 * - network: เครื่องพิมพ์ LAN/WiFi ส่งผ่าน TCP socket (ปกติ port 9100) ใช้ได้ทั้ง desktop และ Docker
 * - windows_share: เครื่องพิมพ์ USB ที่แชร์ไว้ใน Windows — เขียน raw ผ่าน UNC path เช่น \\localhost\POS80
 *   (ใช้ได้เฉพาะ desktop บน Windows; ต้องแชร์เครื่องพิมพ์ใน Windows ก่อน: Printer properties → Sharing)
 */
import net from "node:net";
import fs from "node:fs/promises";
import type { PaperWidth } from "./escpos";

export type PrinterMode = "network" | "windows_share";

export type PrinterConfig = {
  enabled: boolean;
  mode: PrinterMode;
  /** network: IP/hostname ของเครื่องพิมพ์ */
  host: string;
  /** network: TCP port (ค่ามาตรฐาน 9100) */
  port: number;
  /** windows_share: UNC path ของเครื่องพิมพ์ที่แชร์ไว้ เช่น \\localhost\POS80 */
  share: string;
  paperWidth: PaperWidth;
  /** หมายเลข code page ไทย (ESC t n) — Epson ไทยมักใช้ 96 */
  codepage: number;
  /** พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน */
  autoPrint: boolean;
  /** เตะลิ้นชักเก็บเงินเมื่อชำระเงินสด */
  openDrawer: boolean;
};

const CONNECT_TIMEOUT_MS = 5_000;

export async function sendToPrinter(cfg: PrinterConfig, data: Buffer): Promise<void> {
  if (cfg.mode === "windows_share") return sendViaWindowsShare(cfg, data);
  return sendViaNetwork(cfg, data);
}

function sendViaNetwork(cfg: PrinterConfig, data: Buffer): Promise<void> {
  if (!cfg.host) return Promise.reject(new Error("ยังไม่ได้ตั้งค่า IP เครื่องพิมพ์"));
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host: cfg.host, port: cfg.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`เชื่อมต่อเครื่องพิมพ์ ${cfg.host}:${cfg.port} ไม่สำเร็จ (timeout) — เช็กว่าเครื่องพิมพ์เปิดอยู่และอยู่ในเครือข่ายเดียวกัน`));
    }, CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      socket.write(data, (err) => {
        clearTimeout(timer);
        socket.end();
        if (err) reject(new Error(`ส่งข้อมูลเข้าเครื่องพิมพ์ไม่สำเร็จ: ${err.message}`));
        else resolve();
      });
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`เชื่อมต่อเครื่องพิมพ์ ${cfg.host}:${cfg.port} ไม่ได้: ${err.message}`));
    });
  });
}

async function sendViaWindowsShare(cfg: PrinterConfig, data: Buffer): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("โหมด Windows share ใช้ได้เฉพาะแอป desktop บน Windows — ถ้ารันแบบ Docker ให้ใช้โหมด network");
  }
  const target = cfg.share.trim();
  if (!target.startsWith("\\\\")) {
    throw new Error("กรอก path เครื่องพิมพ์ที่แชร์ไว้ ขึ้นต้นด้วย \\\\ เช่น \\\\localhost\\POS80 (ต้องแชร์เครื่องพิมพ์ใน Windows ก่อน)");
  }
  try {
    await fs.writeFile(target, data);
  } catch (err) {
    throw new Error(
      `เขียนข้อมูลเข้าเครื่องพิมพ์ ${target} ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

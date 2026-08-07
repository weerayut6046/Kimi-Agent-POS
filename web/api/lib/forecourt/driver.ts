// interface กลางของ driver ตู้จ่ายและเกจวัดถัง
//
// PRD v3 หัวข้อ 8.6 กำหนดว่า "ทุก driver ต้องแยกเป็นโมดูลอิสระที่มี interface เดียวกัน
// เพื่อเพิ่มยี่ห้อใหม่ได้โดยไม่แตะโค้ดหลัก และต้องมีโหมดจำลองสำหรับพัฒนาและทดสอบ
// โดยไม่ต้องมีฮาร์ดแวร์จริง" ไฟล์นี้คือ interface นั้น
//
// การเพิ่ม IFSF / Tokheim / Wayne DART ทำได้โดยสร้างไฟล์ใหม่ที่ implement
// `ForecourtDriver` แล้วลงทะเบียนใน registry เท่านั้น ไม่ต้องแก้ตรรกะลานจ่าย

import type { ForecourtEvent, NozzlePreset } from "@contracts/forecourt";

export type DriverAck =
  | { ok: true }
  /** ข้อความต้องบอกว่าเกิดอะไรและต้องทำอะไรต่อ ตาม PRD 11.3 */
  | { ok: false; message: string };

export type ForecourtDriverInfo = {
  /** รหัสที่ใช้ตั้งค่าในสาขา เช่น "simulator", "ifsf", "tokheim" */
  id: string;
  name: string;
  protocol: string;
};

/** ค่ามิเตอร์สะสมของหัวจ่าย ใช้ตอนเปิด/ปิดกะ (M4-02) */
export type NozzleMeterReading = {
  nozzleId: number;
  /** มิเตอร์ลิตรสะสม (L) */
  totalLiters: number;
  /** มิเตอร์เงินสะสม (P) */
  totalMoney: number;
  at: string;
};

export type Unsubscribe = () => void;

export interface ForecourtDriver {
  readonly info: ForecourtDriverInfo;

  /** เริ่มเชื่อมต่อกับตู้ — ต้องเรียกซ้ำได้โดยไม่เกิดผลข้างเคียง */
  start(): Promise<void>;
  stop(): Promise<void>;

  /**
   * รับเหตุการณ์จากตู้ ผู้เรียกต้องส่งต่อให้ `parseForecourtEvent` ตรวจก่อนใช้เสมอ
   * เพราะ driver ของยี่ห้อจริงอ่านค่าจากสายที่อาจมีสัญญาณรบกวน
   */
  subscribe(listener: (event: ForecourtEvent) => void): Unsubscribe;

  /** อนุญาตให้หัวจ่ายจ่ายน้ำมัน พร้อมค่าที่ตั้งไว้ล่วงหน้าสำหรับ pre-pay (M1-04, M1-05) */
  authorize(nozzleId: number, preset: NozzlePreset): Promise<DriverAck>;

  /** สั่งหยุดหัวจ่าย (M1-05) */
  stopNozzle(nozzleId: number): Promise<DriverAck>;

  /**
   * ส่งราคาใหม่ลงตู้ (M7-03)
   * ต้องตอบกลับว่าตู้รับราคาแล้วจริง ไม่ใช่แค่ส่งคำสั่งออกไป
   */
  setPrice(nozzleId: number, unitPrice: number): Promise<DriverAck>;

  /** อ่านมิเตอร์สะสมทุกหัว ใช้ตอนเปิด/ปิดกะ (M4-02) */
  readMeters(): Promise<NozzleMeterReading[]>;
}

// ---------- เกจวัดถังใต้ดิน ----------

/** ค่าที่อ่านได้จากเกจ ATG ตาม M6-01 */
export type AtgTankReading = {
  tankId: number;
  volumeLiters: number;
  /** ระดับน้ำในถัง — ใช้เตือนตาม M6-03 */
  waterLiters: number;
  temperatureC: number;
  /** พื้นที่ว่างที่ยังเติมได้ */
  ullageLiters: number;
  at: string;
};

export interface AtgDriver {
  readonly info: ForecourtDriverInfo;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (reading: AtgTankReading) => void): Unsubscribe;
  readAll(): Promise<AtgTankReading[]>;
}

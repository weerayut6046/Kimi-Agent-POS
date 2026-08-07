// ตัวจำลองตู้จ่ายน้ำมัน
//
// เป็น deliverable ของ P0 ใน PRD v3 หัวข้อ 14 และเป็นข้อกำหนดของ 8.6 ที่ว่า
// ทุก driver ต้องมีโหมดจำลองสำหรับพัฒนาและทดสอบโดยไม่ต้องมีฮาร์ดแวร์จริง
//
// ตัวจำลองเดินด้วยนาฬิกาภายในของตัวเอง ไม่ใช่เวลาจริง เพื่อให้เทสต์เดินน้ำมัน
// 30 วินาทีได้ทันทีโดยไม่ต้องรอ และให้ผลเหมือนเดิมทุกครั้ง

import type {
  AtgDriver,
  AtgTankReading,
  DriverAck,
  ForecourtDriver,
  ForecourtDriverInfo,
  NozzleMeterReading,
  Unsubscribe,
} from "./driver";
import type { ForecourtEvent, NozzlePreset } from "@contracts/forecourt";
import { NO_PRESET } from "@contracts/forecourt";

const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

export type SimulatorNozzle = {
  nozzleId: number;
  label: string;
  fuelLabel: string;
  unitPrice: number;
  /** มิเตอร์ลิตรสะสมตั้งต้น (L) */
  startMeter?: number;
  /** มิเตอร์เงินสะสมตั้งต้น (P) */
  startMoney?: number;
};

export type SimulatorOptions = {
  nozzles: readonly SimulatorNozzle[];
  /** อัตราการไหล ค่าปริยาย 0.6 ลิตร/วินาที ใกล้เคียงหัวจ่ายรถยนต์ทั่วไป */
  flowLitersPerSecond?: number;
  /** เวลาเริ่มต้นของนาฬิกาภายใน */
  startAt?: Date;
};

type SimNozzle = {
  config: SimulatorNozzle;
  state: "idle" | "authorized" | "dispensing" | "pending_payment";
  unitPrice: number;
  preset: NozzlePreset;
  totalLiters: number;
  totalMoney: number;
  /** ลิตรที่จ่ายไปแล้วในรายการปัจจุบัน */
  currentLiters: number;
  meterStart: number;
};

export type ForecourtSimulator = ForecourtDriver & {
  /** จำลองพนักงานยกหัวจ่ายออกจากแท่น */
  liftNozzle(nozzleId: number): void;
  /** จำลองการวางหัวจ่ายคืน — จบรายการและส่งยอดสุดท้าย */
  hangUpNozzle(nozzleId: number): void;
  /** จำลองการเคลียร์หัวจ่ายหลังเก็บเงินเสร็จ ให้กลับมาว่าง */
  resetNozzle(nozzleId: number): void;
  /** เดินนาฬิกาภายในไปข้างหน้า ทำให้น้ำมันไหลตามอัตราที่ตั้งไว้ */
  advance(seconds: number): void;
  /** ส่งข้อมูลดิบอะไรก็ได้ออกไป ใช้ทดสอบว่าระบบทนข้อมูลผิดรูปแบบ (PRD 13.2 ข้อ 9) */
  emitRaw(raw: unknown): void;
};

const INFO: ForecourtDriverInfo = {
  id: "simulator",
  name: "ตัวจำลองตู้จ่าย",
  protocol: "simulator",
};

export function createForecourtSimulator(
  options: SimulatorOptions
): ForecourtSimulator {
  const flow = options.flowLitersPerSecond ?? 0.6;
  let clockMs = (
    options.startAt ?? new Date("2026-08-07T08:00:00.000Z")
  ).getTime();
  let running = false;

  const listeners = new Set<(event: ForecourtEvent) => void>();
  const nozzles = new Map<number, SimNozzle>();

  for (const config of options.nozzles) {
    nozzles.set(config.nozzleId, {
      config,
      state: "idle",
      unitPrice: config.unitPrice,
      preset: NO_PRESET,
      totalLiters: config.startMeter ?? 0,
      totalMoney: config.startMoney ?? 0,
      currentLiters: 0,
      meterStart: config.startMeter ?? 0,
    });
  }

  const stamp = () => new Date(clockMs).toISOString();

  function emit(event: ForecourtEvent) {
    if (!running) return;
    for (const listener of listeners) listener(event);
  }

  /** ลิตรสูงสุดที่ preset ยอมให้จ่าย — ไม่มี preset คือไม่จำกัด */
  function presetLimitLiters(nozzle: SimNozzle): number {
    if (nozzle.preset.kind === "volume") return nozzle.preset.liters;
    if (nozzle.preset.kind === "amount" && nozzle.unitPrice > 0) {
      return nozzle.preset.baht / nozzle.unitPrice;
    }
    return Number.POSITIVE_INFINITY;
  }

  function completeDelivery(nozzle: SimNozzle) {
    const liters = round3(nozzle.currentLiters);
    const amount = round2(liters * nozzle.unitPrice);

    nozzle.totalLiters = round3(nozzle.meterStart + liters);
    nozzle.totalMoney = round2(nozzle.totalMoney + amount);
    nozzle.currentLiters = 0;
    nozzle.preset = NO_PRESET;
    nozzle.state = liters > 0 ? "pending_payment" : "idle";

    emit({
      type: "delivery_completed",
      nozzleId: nozzle.config.nozzleId,
      liters,
      amount,
      meterEnd: nozzle.totalLiters,
      at: stamp(),
    });
  }

  return {
    info: INFO,

    async start() {
      running = true;
    },

    async stop() {
      running = false;
    },

    subscribe(listener) {
      listeners.add(listener);
      const unsubscribe: Unsubscribe = () => {
        listeners.delete(listener);
      };
      return unsubscribe;
    },

    async authorize(nozzleId, preset): Promise<DriverAck> {
      const nozzle = nozzles.get(nozzleId);
      if (!nozzle) {
        return { ok: false, message: `ไม่พบหัวจ่าย ${nozzleId} ที่ตู้จ่าย` };
      }
      if (nozzle.state !== "idle") {
        return {
          ok: false,
          message: `${nozzle.config.label} ยังไม่ว่าง — เก็บเงินรายการค้างให้เสร็จก่อน`,
        };
      }
      nozzle.state = "authorized";
      nozzle.preset = preset;
      emit({
        type: "state",
        nozzleId,
        state: "authorized",
        at: stamp(),
      });
      return { ok: true };
    },

    async stopNozzle(nozzleId): Promise<DriverAck> {
      const nozzle = nozzles.get(nozzleId);
      if (!nozzle) {
        return { ok: false, message: `ไม่พบหัวจ่าย ${nozzleId} ที่ตู้จ่าย` };
      }
      if (nozzle.state === "dispensing") {
        completeDelivery(nozzle);
        return { ok: true };
      }
      if (nozzle.state === "authorized") {
        nozzle.state = "idle";
        nozzle.preset = NO_PRESET;
        emit({ type: "state", nozzleId, state: "idle", at: stamp() });
        return { ok: true };
      }
      return { ok: true };
    },

    async setPrice(nozzleId, unitPrice): Promise<DriverAck> {
      const nozzle = nozzles.get(nozzleId);
      if (!nozzle) {
        return { ok: false, message: `ไม่พบหัวจ่าย ${nozzleId} ที่ตู้จ่าย` };
      }
      // M7-04 — ตู้จริงไม่รับราคาใหม่ขณะกำลังจ่าย ตัวจำลองต้องทำเหมือนกัน
      if (nozzle.state === "dispensing") {
        return {
          ok: false,
          message: `${nozzle.config.label} กำลังจ่ายอยู่ — รอจนจบรายการแล้วส่งราคาใหม่อีกครั้ง`,
        };
      }
      nozzle.unitPrice = unitPrice;
      return { ok: true };
    },

    async readMeters(): Promise<NozzleMeterReading[]> {
      const at = stamp();
      return [...nozzles.values()].map(nozzle => ({
        nozzleId: nozzle.config.nozzleId,
        totalLiters: nozzle.totalLiters,
        totalMoney: nozzle.totalMoney,
        at,
      }));
    },

    liftNozzle(nozzleId) {
      const nozzle = nozzles.get(nozzleId);
      if (!nozzle || nozzle.state !== "authorized") return;
      nozzle.state = "dispensing";
      nozzle.meterStart = nozzle.totalLiters;
      nozzle.currentLiters = 0;
      emit({
        type: "delivery_started",
        nozzleId,
        meterStart: nozzle.meterStart,
        unitPrice: nozzle.unitPrice,
        at: stamp(),
      });
    },

    hangUpNozzle(nozzleId) {
      const nozzle = nozzles.get(nozzleId);
      if (!nozzle || nozzle.state !== "dispensing") return;
      completeDelivery(nozzle);
    },

    resetNozzle(nozzleId) {
      const nozzle = nozzles.get(nozzleId);
      if (!nozzle || nozzle.state !== "pending_payment") return;
      nozzle.state = "idle";
      emit({ type: "state", nozzleId, state: "idle", at: stamp() });
    },

    advance(seconds) {
      clockMs += seconds * 1000;
      for (const nozzle of nozzles.values()) {
        if (nozzle.state !== "dispensing") continue;

        const limit = presetLimitLiters(nozzle);
        const wanted = nozzle.currentLiters + flow * seconds;
        const reachedPreset = wanted >= limit;
        nozzle.currentLiters = round3(Math.min(wanted, limit));

        emit({
          type: "delivery_progress",
          nozzleId: nozzle.config.nozzleId,
          liters: nozzle.currentLiters,
          amount: round2(nozzle.currentLiters * nozzle.unitPrice),
          at: stamp(),
        });

        // ตู้จริงตัดการจ่ายเองเมื่อถึงยอดที่ตั้งไว้ล่วงหน้า
        if (reachedPreset) completeDelivery(nozzle);
      }
    },

    emitRaw(raw) {
      if (!running) return;
      // จงใจ cast — จำลองกรณีที่ driver ของยี่ห้อจริงถอดรหัสจากสายผิดพลาด
      // แล้วส่งของที่ไม่ใช่เหตุการณ์ที่ถูกต้องขึ้นมา ผู้รับต้องตรวจเองเสมอ
      for (const listener of listeners) listener(raw as ForecourtEvent);
    },
  };
}

// ---------- ตัวจำลองเกจวัดถัง ----------

export type SimulatorTank = {
  tankId: number;
  capacityLiters: number;
  volumeLiters: number;
  waterLiters?: number;
  temperatureC?: number;
};

export type AtgSimulator = AtgDriver & {
  /** ลดปริมาณในถังตามที่หัวจ่ายจ่ายออกไป */
  drain(tankId: number, liters: number): void;
  /** เพิ่มปริมาณเมื่อรถน้ำมันมาลง */
  fill(tankId: number, liters: number): void;
  /** ตั้งระดับน้ำในถัง ใช้ทดสอบการแจ้งเตือนตาม M6-03 */
  setWater(tankId: number, liters: number): void;
  /** อ่านค่าและส่งให้ผู้ติดตามทุกคน เหมือนรอบอ่านทุก 5 นาทีของ M6-01 */
  poll(): void;
};

const ATG_INFO: ForecourtDriverInfo = {
  id: "atg-simulator",
  name: "ตัวจำลองเกจวัดถัง",
  protocol: "simulator",
};

export function createAtgSimulator(options: {
  tanks: readonly SimulatorTank[];
  startAt?: Date;
}): AtgSimulator {
  const clock = options.startAt ?? new Date("2026-08-07T08:00:00.000Z");
  const listeners = new Set<(reading: AtgTankReading) => void>();
  const tanks = new Map<number, Required<SimulatorTank>>();
  let running = false;

  for (const tank of options.tanks) {
    tanks.set(tank.tankId, {
      tankId: tank.tankId,
      capacityLiters: tank.capacityLiters,
      volumeLiters: tank.volumeLiters,
      waterLiters: tank.waterLiters ?? 0,
      temperatureC: tank.temperatureC ?? 30,
    });
  }

  function read(tank: Required<SimulatorTank>): AtgTankReading {
    return {
      tankId: tank.tankId,
      volumeLiters: round2(tank.volumeLiters),
      waterLiters: round2(tank.waterLiters),
      temperatureC: tank.temperatureC,
      ullageLiters: round2(tank.capacityLiters - tank.volumeLiters),
      at: clock.toISOString(),
    };
  }

  return {
    info: ATG_INFO,

    async start() {
      running = true;
    },

    async stop() {
      running = false;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async readAll() {
      return [...tanks.values()].map(read);
    },

    drain(tankId, liters) {
      const tank = tanks.get(tankId);
      if (!tank) return;
      tank.volumeLiters = Math.max(0, round2(tank.volumeLiters - liters));
    },

    fill(tankId, liters) {
      const tank = tanks.get(tankId);
      if (!tank) return;
      tank.volumeLiters = Math.min(
        tank.capacityLiters,
        round2(tank.volumeLiters + liters)
      );
    },

    setWater(tankId, liters) {
      const tank = tanks.get(tankId);
      if (!tank) return;
      tank.waterLiters = liters;
    },

    poll() {
      if (!running) return;
      for (const tank of tanks.values()) {
        const reading = read(tank);
        for (const listener of listeners) listener(reading);
      }
    },
  };
}

// ตัวเก็บสถานะลานจ่ายประจำสาขา
//
// PRD v3 หัวข้อ 8.2 ข้อ 2 ระบุว่าเมื่อมีเครื่อง POS หลายเครื่อง ต้องมี "จุดเดียว
// ที่รู้ว่าหัวจ่ายไหนถูกจองโดยเครื่องไหน มิฉะนั้นจะเก็บเงินซ้ำ" โมดูลนี้คือจุดนั้น
//
// เก็บไว้ในหน่วยความจำโดยตั้งใจ เพราะเป็นสถานะชั่วขณะของฮาร์ดแวร์ ไม่ใช่ข้อมูลบัญชี
// รายการที่เก็บเงินแล้วจะกลายเป็นบิลในฐานข้อมูลตามปกติ ส่วนการกู้รายการค้างชำระ
// หลังไฟดับ (PRD 13.2 ข้อ 2) ทำโดยอ่านมิเตอร์จากตู้ซ้ำตอนเริ่มระบบ ไม่ใช่จากที่นี่

import {
  canTransition,
  decideClaim,
  NO_PRESET,
  parseForecourtEvent,
} from "@contracts/forecourt";
import type {
  ClaimResult,
  ForecourtDelivery,
  ForecourtEvent,
  ForecourtSnapshot,
  NozzlePreset,
  NozzleSnapshot,
  NozzleState,
} from "@contracts/forecourt";

/** เกินกว่านี้ถือว่าผิดปกติ ต้องบันทึกและแจ้งเตือน (M1-09) */
export const OVERSIZED_DELIVERY_LITERS = 200;

/**
 * ส่วนต่างที่ยอมรับได้ระหว่างลิตรที่ตู้รายงาน กับส่วนต่างของเลขมิเตอร์
 * มิเตอร์เก็บ 3 ตำแหน่ง จึงเผื่อไว้เล็กน้อยสำหรับการปัดเศษของตู้แต่ละยี่ห้อ
 */
export const METER_MATCH_TOLERANCE_LITERS = 0.05;

export type ForecourtAnomalyKind =
  | "invalid_event"
  | "unknown_nozzle"
  | "illegal_transition"
  | "meter_mismatch"
  | "oversized_delivery"
  | "device_fault";

export type ForecourtAnomaly = {
  kind: ForecourtAnomalyKind;
  nozzleId: number | null;
  message: string;
  at: string;
};

export type ApplyResult = {
  applied: boolean;
  anomalies: ForecourtAnomaly[];
};

export type NozzleInit = {
  nozzleId: number;
  islandNo: number;
  label: string;
  fuelLabel: string;
  unitPrice: number;
  active?: boolean;
};

type NozzleRecord = {
  nozzleId: number;
  islandNo: number;
  label: string;
  fuelLabel: string;
  state: NozzleState;
  unitPrice: number;
  preset: NozzlePreset;
  activeDelivery: ForecourtDelivery | null;
  pendingDeliveries: ForecourtDelivery[];
  updatedAt: string;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

function cloneDelivery(delivery: ForecourtDelivery): ForecourtDelivery {
  return { ...delivery };
}

export type ForecourtState = {
  snapshot(): ForecourtSnapshot;
  nozzle(nozzleId: number): NozzleSnapshot | null;

  /** ป้อนเหตุการณ์ดิบจาก driver — ข้อมูลผิดรูปแบบจะถูกปฏิเสธโดยไม่ทำให้ระบบล่ม */
  apply(raw: unknown): ApplyResult;

  /** บันทึกว่าอนุญาตหัวจ่ายแล้ว พร้อมค่า preset สำหรับ pre-pay */
  authorize(nozzleId: number, preset?: NozzlePreset): ApplyResult;

  /** จองรายการค้างชำระให้เครื่อง POS เครื่องหนึ่ง — สำเร็จได้เครื่องเดียวเท่านั้น */
  claim(input: {
    nozzleId: number;
    terminalId: string;
    deliveryId?: string;
  }): ClaimResult;

  /** คืนการจองเมื่อบิลถูกยกเลิก เพื่อให้เครื่องอื่นเก็บเงินต่อได้ */
  releaseClaim(nozzleId: number, deliveryId: string): boolean;

  /** ตัดรายการออกจากคิวเมื่อเก็บเงินเรียบร้อยแล้ว */
  settle(nozzleId: number, deliveryId: string): boolean;

  setPrice(nozzleId: number, unitPrice: number): boolean;
};

export function createForecourtState(
  nozzles: readonly NozzleInit[]
): ForecourtState {
  const records = new Map<number, NozzleRecord>();
  let deliveryCounter = 0;

  for (const init of nozzles) {
    records.set(init.nozzleId, {
      nozzleId: init.nozzleId,
      islandNo: init.islandNo,
      label: init.label,
      fuelLabel: init.fuelLabel,
      state: init.active === false ? "disabled" : "idle",
      unitPrice: init.unitPrice,
      preset: NO_PRESET,
      activeDelivery: null,
      pendingDeliveries: [],
      updatedAt: new Date(0).toISOString(),
    });
  }

  function toSnapshot(record: NozzleRecord): NozzleSnapshot {
    return {
      nozzleId: record.nozzleId,
      islandNo: record.islandNo,
      label: record.label,
      fuelLabel: record.fuelLabel,
      state: record.state,
      unitPrice: record.unitPrice,
      preset: record.preset,
      activeDelivery: record.activeDelivery
        ? cloneDelivery(record.activeDelivery)
        : null,
      pendingDeliveries: record.pendingDeliveries.map(cloneDelivery),
      updatedAt: record.updatedAt,
    };
  }

  function anomaly(
    kind: ForecourtAnomalyKind,
    nozzleId: number | null,
    message: string,
    at: string
  ): ForecourtAnomaly {
    return { kind, nozzleId, message, at };
  }

  function moveTo(
    record: NozzleRecord,
    next: NozzleState,
    at: string
  ): ForecourtAnomaly | null {
    if (!canTransition(record.state, next)) {
      return anomaly(
        "illegal_transition",
        record.nozzleId,
        `${record.label}: ตู้จ่ายรายงานสถานะ ${next} ขณะที่ระบบเห็นเป็น ${record.state} — ข้ามเหตุการณ์นี้`,
        at
      );
    }
    record.state = next;
    record.updatedAt = at;
    return null;
  }

  function applyEvent(event: ForecourtEvent): ApplyResult {
    const anomalies: ForecourtAnomaly[] = [];

    if (event.type === "fault") {
      anomalies.push(
        anomaly("device_fault", event.nozzleId, event.message, event.at)
      );
      return { applied: true, anomalies };
    }

    const record = records.get(event.nozzleId);
    if (!record) {
      anomalies.push(
        anomaly(
          "unknown_nozzle",
          event.nozzleId,
          `ได้รับเหตุการณ์จากหัวจ่าย ${event.nozzleId} ที่ไม่มีในการตั้งค่าของสาขา`,
          event.at
        )
      );
      return { applied: false, anomalies };
    }

    switch (event.type) {
      case "state": {
        const problem = moveTo(record, event.state, event.at);
        if (problem) {
          anomalies.push(problem);
          return { applied: false, anomalies };
        }
        if (event.state === "idle") {
          record.preset = NO_PRESET;
        }
        return { applied: true, anomalies };
      }

      case "delivery_started": {
        const problem = moveTo(record, "dispensing", event.at);
        if (problem) {
          anomalies.push(problem);
          return { applied: false, anomalies };
        }
        deliveryCounter += 1;
        record.activeDelivery = {
          id: `d${deliveryCounter}`,
          nozzleId: record.nozzleId,
          // ราคาถูกล็อกไว้ตั้งแต่เริ่มจ่าย การเปลี่ยนราคาระหว่างทางไม่กระทบรายการนี้ (M7-04)
          unitPrice: event.unitPrice,
          liters: 0,
          amount: 0,
          meterStart: event.meterStart,
          meterEnd: null,
          startedAt: event.at,
          completedAt: null,
          claimedByTerminal: null,
          claimedAt: null,
        };
        return { applied: true, anomalies };
      }

      case "delivery_progress": {
        if (!record.activeDelivery) {
          anomalies.push(
            anomaly(
              "illegal_transition",
              record.nozzleId,
              `${record.label}: ได้รับยอดระหว่างจ่ายทั้งที่ยังไม่มีรายการเปิดอยู่`,
              event.at
            )
          );
          return { applied: false, anomalies };
        }
        record.activeDelivery.liters = event.liters;
        record.activeDelivery.amount = event.amount;
        record.updatedAt = event.at;
        return { applied: true, anomalies };
      }

      case "delivery_completed": {
        const delivery = record.activeDelivery;
        if (!delivery) {
          anomalies.push(
            anomaly(
              "illegal_transition",
              record.nozzleId,
              `${record.label}: ได้รับรายการจบทั้งที่ยังไม่มีรายการเปิดอยู่`,
              event.at
            )
          );
          return { applied: false, anomalies };
        }

        // PRD 9.3 — ลิตรที่ขายต้องตรงกับส่วนต่างเลขมิเตอร์เสมอ
        const meterLiters = round3(event.meterEnd - delivery.meterStart);
        if (
          Math.abs(meterLiters - event.liters) > METER_MATCH_TOLERANCE_LITERS
        ) {
          anomalies.push(
            anomaly(
              "meter_mismatch",
              record.nozzleId,
              `${record.label}: ตู้รายงาน ${event.liters.toFixed(3)} ลิตร แต่ส่วนต่างมิเตอร์คือ ${meterLiters.toFixed(3)} ลิตร — ตรวจสอบก่อนเก็บเงิน`,
              event.at
            )
          );
        }

        if (event.liters > OVERSIZED_DELIVERY_LITERS) {
          anomalies.push(
            anomaly(
              "oversized_delivery",
              record.nozzleId,
              `${record.label}: จ่าย ${event.liters.toFixed(3)} ลิตรในรายการเดียว เกินเกณฑ์ ${OVERSIZED_DELIVERY_LITERS} ลิตร`,
              event.at
            )
          );
        }

        delivery.liters = event.liters;
        delivery.amount = event.amount;
        delivery.meterEnd = event.meterEnd;
        delivery.completedAt = event.at;
        record.activeDelivery = null;
        record.preset = NO_PRESET;

        // จ่าย 0 ลิตร (ยกหัวจ่ายแล้ววางคืน) ไม่ต้องเก็บเงิน กลับไปว่างเลย
        if (event.liters <= 0) {
          const problem = moveTo(record, "idle", event.at);
          if (problem) anomalies.push(problem);
          return { applied: true, anomalies };
        }

        record.pendingDeliveries.push(delivery);
        const problem = moveTo(record, "pending_payment", event.at);
        if (problem) anomalies.push(problem);
        return { applied: true, anomalies };
      }
    }
  }

  return {
    snapshot() {
      const list = [...records.values()].map(toSnapshot);
      list.sort((a, b) => a.islandNo - b.islandNo || a.nozzleId - b.nozzleId);
      const updatedAt = list.reduce(
        (latest, n) => (n.updatedAt > latest ? n.updatedAt : latest),
        new Date(0).toISOString()
      );
      return { nozzles: list, updatedAt };
    },

    nozzle(nozzleId) {
      const record = records.get(nozzleId);
      return record ? toSnapshot(record) : null;
    },

    apply(raw) {
      const event = parseForecourtEvent(raw);
      if (!event) {
        // ตู้จ่ายส่งข้อมูลผิดรูปแบบ — บันทึกแล้วเดินต่อ ห้ามล่ม (PRD 13.2 ข้อ 9)
        return {
          applied: false,
          anomalies: [
            anomaly(
              "invalid_event",
              null,
              "ได้รับข้อมูลผิดรูปแบบจากตู้จ่าย — ข้ามเหตุการณ์นี้",
              new Date().toISOString()
            ),
          ],
        };
      }
      return applyEvent(event);
    },

    authorize(nozzleId, preset = NO_PRESET) {
      const at = new Date().toISOString();
      const record = records.get(nozzleId);
      if (!record) {
        return {
          applied: false,
          anomalies: [
            anomaly(
              "unknown_nozzle",
              nozzleId,
              `ไม่พบหัวจ่าย ${nozzleId} ในการตั้งค่าของสาขา`,
              at
            ),
          ],
        };
      }
      const problem = moveTo(record, "authorized", at);
      if (problem) return { applied: false, anomalies: [problem] };
      record.preset = preset;
      return { applied: true, anomalies: [] };
    },

    claim({ nozzleId, terminalId, deliveryId }) {
      const record = records.get(nozzleId);
      if (!record) {
        return {
          ok: false,
          reason: "nozzle_not_found",
          message: `ไม่พบหัวจ่าย ${nozzleId} ในการตั้งค่าของสาขา`,
        };
      }

      // ระหว่าง decideClaim กับการเขียน claimedByTerminal ไม่มี await คั่น
      // เครื่อง POS สองเครื่องที่ยิงเข้ามาพร้อมกันจึงถูกจัดลำดับโดย event loop
      // และมีเครื่องเดียวที่ได้รายการไป (PRD 13.2 ข้อ 3)
      const decision = decideClaim({
        pendingDeliveries: record.pendingDeliveries,
        terminalId,
        deliveryId,
      });
      if (!decision.ok) return decision;

      const target = record.pendingDeliveries.find(
        d => d.id === decision.delivery.id
      );
      if (!target) {
        return {
          ok: false,
          reason: "nozzle_not_found",
          message: "ไม่พบรายการที่ต้องการเก็บเงิน — รายการอาจถูกเก็บเงินไปแล้ว",
        };
      }

      target.claimedByTerminal = terminalId;
      target.claimedAt = new Date().toISOString();
      return { ok: true, delivery: cloneDelivery(target) };
    },

    releaseClaim(nozzleId, deliveryId) {
      const record = records.get(nozzleId);
      if (!record) return false;
      const target = record.pendingDeliveries.find(d => d.id === deliveryId);
      if (!target) return false;
      target.claimedByTerminal = null;
      target.claimedAt = null;
      return true;
    },

    settle(nozzleId, deliveryId) {
      const record = records.get(nozzleId);
      if (!record) return false;
      const index = record.pendingDeliveries.findIndex(
        d => d.id === deliveryId
      );
      if (index < 0) return false;
      record.pendingDeliveries.splice(index, 1);
      const at = new Date().toISOString();
      // ยังมีรายการค้างที่หัวเดิมอยู่ก็ยังต้องขึ้น "รอชำระเงิน" ต่อไป (M1-07)
      if (
        record.pendingDeliveries.length === 0 &&
        record.state === "pending_payment"
      ) {
        moveTo(record, "idle", at);
      } else {
        record.updatedAt = at;
      }
      return true;
    },

    setPrice(nozzleId, unitPrice) {
      const record = records.get(nozzleId);
      if (!record) return false;
      record.unitPrice = round2(unitPrice);
      record.updatedAt = new Date().toISOString();
      return true;
    },
  };
}

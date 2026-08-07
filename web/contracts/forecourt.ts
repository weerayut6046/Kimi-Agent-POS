// สัญญากลางของลานจ่าย (forecourt) — ใช้ร่วมกันทั้ง driver, API และหน้าจอ POS
//
// ไฟล์นี้ไม่ผูกกับยี่ห้อตู้จ่ายใด ๆ และไม่มี dependency ภายนอก เพื่อให้ทั้งฝั่ง
// เซิร์ฟเวอร์ (ที่คุยกับตู้จริง) และฝั่งหน้าจอ (ที่แสดงผล) เห็นสถานะชุดเดียวกัน
// ตาม PRD v3 หัวข้อ M1 และ 8.6

const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * สถานะของหัวจ่าย ตรงกับที่ M1-01 กำหนดให้พนักงานต้องเห็น
 * `authorized` เป็นสถานะระหว่างทาง: อนุญาตแล้วแต่ยังไม่มีน้ำมันไหล
 */
export type NozzleState =
  "idle" | "authorized" | "dispensing" | "pending_payment" | "disabled";

/**
 * คำที่ใช้บนหน้าจอ — ใช้คำที่พนักงานปั๊มใช้จริงตาม PRD 11.3
 * ห้ามแปลตรงตัวจากชื่อสถานะภาษาอังกฤษ
 */
export const NOZZLE_STATE_LABEL_TH: Record<NozzleState, string> = {
  idle: "ว่าง",
  authorized: "อนุญาตแล้ว",
  dispensing: "กำลังจ่าย",
  pending_payment: "รอชำระเงิน",
  disabled: "ปิดใช้งาน",
};

/**
 * ลำดับความสำคัญในการดึงสายตา — ตัวเลขมากคือต้องเด่นกว่า
 * PRD 11.1 ข้อ 3 กำหนดว่า "รอชำระเงิน" ต้องเด่นที่สุดเสมอ
 */
export const NOZZLE_STATE_PRIORITY: Record<NozzleState, number> = {
  pending_payment: 4,
  dispensing: 3,
  authorized: 2,
  idle: 1,
  disabled: 0,
};

/**
 * การเปลี่ยนสถานะที่อนุญาต — ตั้งใจให้แคบไว้ก่อน
 * ตู้จ่ายที่ส่งลำดับสถานะแปลก ๆ มาต้องถูกปฏิเสธและบันทึก log
 * ไม่ใช่ทำให้สถานะบนจอเพี้ยนตาม (PRD 13.2 ข้อ 9)
 */
const ALLOWED_TRANSITIONS: Record<NozzleState, readonly NozzleState[]> = {
  idle: ["authorized", "disabled"],
  authorized: ["dispensing", "idle"],
  dispensing: ["pending_payment", "idle"],
  pending_payment: ["idle"],
  disabled: ["idle"],
};

export function canTransition(from: NozzleState, to: NozzleState): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** ค่าที่ตั้งไว้ล่วงหน้าสำหรับโหมดจ่ายเงินก่อนเติม (M1-04) */
export type NozzlePreset =
  | { kind: "none" }
  | { kind: "amount"; baht: number }
  | { kind: "volume"; liters: number };

export const NO_PRESET: NozzlePreset = { kind: "none" };

/**
 * รายการจ่ายน้ำมันหนึ่งครั้งที่หัวจ่ายหนึ่งหัว
 * เกิดขึ้นจากตู้จ่าย ไม่ใช่จากการคีย์ของพนักงาน — เลขมิเตอร์จึงแก้ด้วยมือไม่ได้ (PRD 12.4)
 */
export type ForecourtDelivery = {
  id: string;
  nozzleId: number;
  /** ราคาต่อลิตร ณ เวลาที่เริ่มจ่าย — ล็อกไว้ตลอดรายการแม้ราคาจะเปลี่ยนระหว่างทาง (M7-04) */
  unitPrice: number;
  liters: number;
  amount: number;
  meterStart: number;
  meterEnd: number | null;
  startedAt: string;
  completedAt: string | null;
  /** เครื่อง POS ที่จองรายการนี้ไว้เก็บเงิน — null คือยังไม่มีใครจอง */
  claimedByTerminal: string | null;
  claimedAt: string | null;
};

/** สถานะหัวจ่ายหนึ่งหัวที่ส่งให้หน้าจอ */
export type NozzleSnapshot = {
  nozzleId: number;
  /** หมายเลขเกาะจ่ายจริง เพื่อให้ผังบนจอตรงกับผังหน้างาน (PRD 11.1 ข้อ 2) */
  islandNo: number;
  label: string;
  fuelLabel: string;
  state: NozzleState;
  unitPrice: number;
  preset: NozzlePreset;
  /** รายการที่กำลังจ่ายอยู่ ณ ตอนนี้ */
  activeDelivery: ForecourtDelivery | null;
  /** รายการที่จ่ายเสร็จแล้วแต่ยังไม่ได้เก็บเงิน เรียงเก่าไปใหม่ (M1-07) */
  pendingDeliveries: ForecourtDelivery[];
  updatedAt: string;
};

export type ForecourtSnapshot = {
  nozzles: NozzleSnapshot[];
  updatedAt: string;
};

// ---------- เหตุการณ์จากตู้จ่าย ----------

export type ForecourtEvent =
  | { type: "state"; nozzleId: number; state: NozzleState; at: string }
  | {
      type: "delivery_started";
      nozzleId: number;
      meterStart: number;
      unitPrice: number;
      at: string;
    }
  | {
      type: "delivery_progress";
      nozzleId: number;
      liters: number;
      amount: number;
      at: string;
    }
  | {
      type: "delivery_completed";
      nozzleId: number;
      liters: number;
      amount: number;
      meterEnd: number;
      at: string;
    }
  | { type: "fault"; nozzleId: number | null; message: string; at: string };

const NOZZLE_STATES: readonly NozzleState[] = [
  "idle",
  "authorized",
  "dispensing",
  "pending_payment",
  "disabled",
];

function isNozzleState(value: unknown): value is NozzleState {
  return (
    typeof value === "string" && NOZZLE_STATES.includes(value as NozzleState)
  );
}

/** ตัวเลขที่ยอมรับได้: ต้องเป็นจำนวนจริงที่ไม่ติดลบ และไม่ใช่ NaN/Infinity */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isStamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

/**
 * แปลงข้อมูลดิบจากตู้จ่ายให้เป็นเหตุการณ์ที่เชื่อถือได้
 *
 * ฟังก์ชันนี้ **ต้องไม่ throw ไม่ว่าจะได้รับอะไรมา** เพราะตู้จ่ายที่สายหลวมหรือ
 * เฟิร์มแวร์ต่างรุ่นส่งข้อมูลผิดรูปแบบมาได้เสมอ และระบบขายต้องไม่ล่มตาม
 * (PRD 13.2 ข้อ 9) คืน `null` เมื่อข้อมูลใช้ไม่ได้ ให้ผู้เรียกบันทึก log แล้วข้ามไป
 */
export function parseForecourtEvent(raw: unknown): ForecourtEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const event = raw as Record<string, unknown>;
  if (!isStamp(event.at)) return null;
  const at = event.at;

  switch (event.type) {
    case "state":
      if (!isId(event.nozzleId) || !isNozzleState(event.state)) return null;
      return {
        type: "state",
        nozzleId: event.nozzleId,
        state: event.state,
        at,
      };

    case "delivery_started":
      if (
        !isId(event.nozzleId) ||
        !isCount(event.meterStart) ||
        !isCount(event.unitPrice) ||
        event.unitPrice === 0
      ) {
        return null;
      }
      return {
        type: "delivery_started",
        nozzleId: event.nozzleId,
        meterStart: round3(event.meterStart),
        unitPrice: event.unitPrice,
        at,
      };

    case "delivery_progress":
      if (
        !isId(event.nozzleId) ||
        !isCount(event.liters) ||
        !isCount(event.amount)
      ) {
        return null;
      }
      return {
        type: "delivery_progress",
        nozzleId: event.nozzleId,
        liters: round3(event.liters),
        amount: round2(event.amount),
        at,
      };

    case "delivery_completed":
      if (
        !isId(event.nozzleId) ||
        !isCount(event.liters) ||
        !isCount(event.amount) ||
        !isCount(event.meterEnd)
      ) {
        return null;
      }
      return {
        type: "delivery_completed",
        nozzleId: event.nozzleId,
        liters: round3(event.liters),
        amount: round2(event.amount),
        meterEnd: round3(event.meterEnd),
        at,
      };

    case "fault":
      if (typeof event.message !== "string" || event.message.length === 0) {
        return null;
      }
      if (event.nozzleId !== null && !isId(event.nozzleId)) return null;
      return {
        type: "fault",
        nozzleId: event.nozzleId as number | null,
        message: event.message,
        at,
      };

    default:
      return null;
  }
}

// ---------- การจองรายการค้างชำระ ----------

export type ClaimFailureReason =
  "nozzle_not_found" | "nothing_pending" | "already_claimed";

export type ClaimResult =
  | { ok: true; delivery: ForecourtDelivery }
  | {
      ok: false;
      reason: ClaimFailureReason;
      /** ข้อความภาษาไทยที่แสดงให้พนักงานได้ทันที ตาม PRD 10.4 และ 11.3 */
      message: string;
      claimedByTerminal?: string;
    };

/**
 * ตัดสินว่าเครื่อง POS เครื่องหนึ่งจองรายการค้างชำระได้หรือไม่
 *
 * นี่คือจุดที่กันการเก็บเงินซ้ำเมื่อมีเครื่อง POS หลายเครื่องในสาขาเดียว
 * (PRD 8.2 ข้อ 2 และสถานการณ์ทดสอบ 13.2 ข้อ 3) การตัดสินใจอยู่ที่นี่เพียงจุดเดียว
 * เพื่อให้ทดสอบได้โดยไม่ต้องมีตู้จ่ายหรือฐานข้อมูล
 *
 * การจองซ้ำโดยเครื่องเดิมถือว่าสำเร็จ เพื่อให้เครื่องที่เน็ตกระตุกแล้วยิงซ้ำ
 * ไม่เจอ error ทั้งที่ตัวเองเป็นเจ้าของรายการอยู่แล้ว
 */
export function decideClaim(input: {
  pendingDeliveries: readonly ForecourtDelivery[];
  terminalId: string;
  /** ระบุเมื่อต้องการจองรายการใดรายการหนึ่ง — ไม่ระบุคือจองรายการที่เก่าที่สุด */
  deliveryId?: string;
}): ClaimResult {
  const queue = input.deliveryId
    ? input.pendingDeliveries.filter(d => d.id === input.deliveryId)
    : input.pendingDeliveries;

  if (queue.length === 0) {
    return {
      ok: false,
      reason: input.deliveryId ? "nozzle_not_found" : "nothing_pending",
      message: input.deliveryId
        ? "ไม่พบรายการที่ต้องการเก็บเงิน — รายการอาจถูกเก็บเงินไปแล้ว"
        : "หัวจ่ายนี้ไม่มีรายการรอชำระ",
    };
  }

  const target = queue[0]!;

  if (
    target.claimedByTerminal &&
    target.claimedByTerminal !== input.terminalId
  ) {
    return {
      ok: false,
      reason: "already_claimed",
      message: `รายการนี้ถูกเครื่อง ${target.claimedByTerminal} เปิดบิลไปแล้ว — ให้เครื่องนั้นเก็บเงินต่อ`,
      claimedByTerminal: target.claimedByTerminal,
    };
  }

  return { ok: true, delivery: target };
}

// ---------- การเปลี่ยนราคาระหว่างจ่าย ----------

export type PriceChangeBlock = {
  nozzleId: number;
  label: string;
};

/**
 * ตรวจว่าเปลี่ยนราคาได้หรือยัง
 *
 * M7-04 ห้ามเปลี่ยนราคาขณะที่ยังมีหัวจ่ายกำลังจ่ายอยู่ ต้องรอจนจบรายการ
 * หัวที่ "รอชำระเงิน" ไม่บล็อก เพราะราคาของรายการนั้นถูกล็อกไว้ตั้งแต่เริ่มจ่ายแล้ว
 */
export function findPriceChangeBlockers(
  nozzles: readonly NozzleSnapshot[],
  productFuelLabel: string
): PriceChangeBlock[] {
  return nozzles
    .filter(n => n.state === "dispensing" && n.fuelLabel === productFuelLabel)
    .map(n => ({ nozzleId: n.nozzleId, label: n.label }));
}

/** ข้อความบอกว่าติดที่หัวไหน ต้องบอกให้ชัดว่าต้องทำอะไรต่อ (PRD 11.3) */
export function priceChangeBlockedMessage(
  blockers: readonly PriceChangeBlock[]
): string {
  const names = blockers.map(b => b.label).join(", ");
  return `เปลี่ยนราคาไม่ได้ตอนนี้ — ${names} กำลังจ่ายอยู่ รอจนจบรายการแล้วกดอีกครั้ง`;
}

// ---------- การปิดกะขณะมีรายการค้างชำระ ----------

/**
 * PRD 13.2 ข้อ 8 — ปิดกะขณะยังมีหัวจ่ายค้างชำระต้องถูกบล็อก และต้องบอกว่าค้างที่หัวไหน
 */
export function findUnsettledNozzles(
  nozzles: readonly NozzleSnapshot[]
): NozzleSnapshot[] {
  return nozzles.filter(
    n => n.pendingDeliveries.length > 0 || n.state === "dispensing"
  );
}

export function shiftCloseBlockedMessage(
  unsettled: readonly NozzleSnapshot[]
): string {
  const names = unsettled.map(n => n.label).join(", ");
  return `ปิดกะไม่ได้ — ยังมีรายการค้างชำระที่ ${names} เก็บเงินให้ครบก่อนแล้วปิดกะอีกครั้ง`;
}

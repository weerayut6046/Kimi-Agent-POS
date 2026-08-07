import { describe, expect, it } from "vitest";
import { createForecourtState, OVERSIZED_DELIVERY_LITERS } from "./state";
import {
  canTransition,
  findPriceChangeBlockers,
  findUnsettledNozzles,
  NOZZLE_STATE_PRIORITY,
  parseForecourtEvent,
  priceChangeBlockedMessage,
  shiftCloseBlockedMessage,
} from "@contracts/forecourt";

const at = (second: number) =>
  new Date(Date.UTC(2026, 7, 7, 8, 0, second)).toISOString();

function newState() {
  return createForecourtState([
    {
      nozzleId: 1,
      islandNo: 1,
      label: "ตู้ 1 หัว A",
      fuelLabel: "GSH95",
      unitPrice: 38.69,
    },
    {
      nozzleId: 2,
      islandNo: 1,
      label: "ตู้ 1 หัว B",
      fuelLabel: "DB7",
      unitPrice: 32.94,
    },
    {
      nozzleId: 3,
      islandNo: 2,
      label: "ตู้ 2 หัว A",
      fuelLabel: "GSH95",
      unitPrice: 38.69,
    },
  ]);
}

/** จ่ายน้ำมันจบหนึ่งรายการที่หัวจ่ายที่ระบุ */
function dispense(
  state: ReturnType<typeof newState>,
  input: {
    nozzleId: number;
    meterStart: number;
    liters: number;
    unitPrice: number;
    second: number;
  }
) {
  state.authorize(input.nozzleId);
  state.apply({
    type: "delivery_started",
    nozzleId: input.nozzleId,
    meterStart: input.meterStart,
    unitPrice: input.unitPrice,
    at: at(input.second),
  });
  return state.apply({
    type: "delivery_completed",
    nozzleId: input.nozzleId,
    liters: input.liters,
    amount: Math.round(input.liters * input.unitPrice * 100) / 100,
    meterEnd: Math.round((input.meterStart + input.liters) * 1000) / 1000,
    at: at(input.second + 30),
  });
}

describe("การเปลี่ยนสถานะหัวจ่าย", () => {
  it("อนุญาตเฉพาะเส้นทางที่เป็นไปได้จริงหน้าลาน", () => {
    expect(canTransition("idle", "authorized")).toBe(true);
    expect(canTransition("authorized", "dispensing")).toBe(true);
    expect(canTransition("dispensing", "pending_payment")).toBe(true);
    expect(canTransition("pending_payment", "idle")).toBe(true);

    // ข้ามขั้นไม่ได้ — ต้องผ่านการอนุญาตก่อนเสมอ
    expect(canTransition("idle", "dispensing")).toBe(false);
    expect(canTransition("idle", "pending_payment")).toBe(false);
    // เก็บเงินแล้วย้อนกลับไปจ่ายต่อไม่ได้
    expect(canTransition("pending_payment", "dispensing")).toBe(false);
    // ปิดใช้งานกลางคันไม่ได้
    expect(canTransition("dispensing", "disabled")).toBe(false);
  });

  it("ให้ 'รอชำระเงิน' เด่นกว่าสถานะอื่นเสมอ", () => {
    const priorities = NOZZLE_STATE_PRIORITY;
    expect(priorities.pending_payment).toBeGreaterThan(priorities.dispensing);
    expect(priorities.pending_payment).toBeGreaterThan(priorities.authorized);
    expect(priorities.pending_payment).toBeGreaterThan(priorities.idle);
    expect(priorities.pending_payment).toBeGreaterThan(priorities.disabled);
  });

  it("เดินครบหนึ่งรอบตั้งแต่ว่างจนเก็บเงินเสร็จ", () => {
    const state = newState();

    expect(state.nozzle(1)?.state).toBe("idle");

    state.authorize(1);
    expect(state.nozzle(1)?.state).toBe("authorized");

    state.apply({
      type: "delivery_started",
      nozzleId: 1,
      meterStart: 397_079.76,
      unitPrice: 38.69,
      at: at(0),
    });
    expect(state.nozzle(1)?.state).toBe("dispensing");
    expect(state.nozzle(1)?.activeDelivery?.meterStart).toBe(397_079.76);

    state.apply({
      type: "delivery_progress",
      nozzleId: 1,
      liters: 10,
      amount: 386.9,
      at: at(17),
    });
    expect(state.nozzle(1)?.activeDelivery?.liters).toBe(10);

    state.apply({
      type: "delivery_completed",
      nozzleId: 1,
      liters: 18,
      amount: 696.42,
      meterEnd: 397_097.76,
      at: at(30),
    });

    const nozzle = state.nozzle(1)!;
    expect(nozzle.state).toBe("pending_payment");
    expect(nozzle.activeDelivery).toBeNull();
    expect(nozzle.pendingDeliveries).toHaveLength(1);
    expect(nozzle.pendingDeliveries[0]).toMatchObject({
      liters: 18,
      amount: 696.42,
      meterStart: 397_079.76,
      meterEnd: 397_097.76,
    });

    const claim = state.claim({ nozzleId: 1, terminalId: "POS-1" });
    expect(claim.ok).toBe(true);

    state.settle(1, nozzle.pendingDeliveries[0]!.id);
    expect(state.nozzle(1)?.state).toBe("idle");
    expect(state.nozzle(1)?.pendingDeliveries).toHaveLength(0);
  });

  it("ยกหัวจ่ายแล้ววางคืนโดยไม่จ่ายเลย ต้องกลับไปว่างโดยไม่ต้องเก็บเงิน", () => {
    const state = newState();
    const result = dispense(state, {
      nozzleId: 1,
      meterStart: 1_000,
      liters: 0,
      unitPrice: 38.69,
      second: 0,
    });

    expect(result.applied).toBe(true);
    expect(state.nozzle(1)?.state).toBe("idle");
    expect(state.nozzle(1)?.pendingDeliveries).toHaveLength(0);
  });

  it("ปฏิเสธการเปลี่ยนสถานะที่เป็นไปไม่ได้ และคงสถานะเดิมไว้", () => {
    const state = newState();
    const result = state.apply({
      type: "state",
      nozzleId: 1,
      state: "pending_payment",
      at: at(0),
    });

    expect(result.applied).toBe(false);
    expect(result.anomalies[0]?.kind).toBe("illegal_transition");
    expect(state.nozzle(1)?.state).toBe("idle");
  });
});

describe("ข้อมูลผิดรูปแบบจากตู้จ่าย", () => {
  // PRD 13.2 ข้อ 9 — ตู้จ่ายส่งข้อมูลผิดรูปแบบ ระบบต้องไม่ล่มและบันทึก log
  const garbage = [
    null,
    undefined,
    "",
    "ไม่ใช่ JSON",
    42,
    [],
    {},
    { type: "state" },
    { type: "state", nozzleId: 1, state: "ระเบิด", at: at(0) },
    { type: "state", nozzleId: 0, state: "idle", at: at(0) },
    { type: "state", nozzleId: 1.5, state: "idle", at: at(0) },
    { type: "state", nozzleId: 1, state: "idle", at: "เมื่อวาน" },
    {
      type: "delivery_progress",
      nozzleId: 1,
      liters: NaN,
      amount: 0,
      at: at(0),
    },
    {
      type: "delivery_progress",
      nozzleId: 1,
      liters: -5,
      amount: 0,
      at: at(0),
    },
    {
      type: "delivery_progress",
      nozzleId: 1,
      liters: Number.POSITIVE_INFINITY,
      amount: 0,
      at: at(0),
    },
    {
      type: "delivery_started",
      nozzleId: 1,
      meterStart: 0,
      unitPrice: 0,
      at: at(0),
    },
    { type: "รายการใหม่ที่ยังไม่รู้จัก", nozzleId: 1, at: at(0) },
  ];

  it("คัดข้อมูลที่ใช้ไม่ได้ออกทุกกรณีโดยไม่ throw", () => {
    for (const raw of garbage) {
      expect(() => parseForecourtEvent(raw)).not.toThrow();
      expect(parseForecourtEvent(raw)).toBeNull();
    }
  });

  it("ระบบขายเดินต่อได้ตามปกติหลังได้รับข้อมูลขยะ", () => {
    const state = newState();
    state.authorize(1);

    for (const raw of garbage) {
      const result = state.apply(raw);
      expect(result.applied).toBe(false);
      expect(result.anomalies).not.toHaveLength(0);
    }

    // สถานะเดิมไม่ถูกทำลาย และยังรับเหตุการณ์ที่ถูกต้องต่อได้
    expect(state.nozzle(1)?.state).toBe("authorized");
    const ok = state.apply({
      type: "delivery_started",
      nozzleId: 1,
      meterStart: 500,
      unitPrice: 38.69,
      at: at(1),
    });
    expect(ok.applied).toBe(true);
    expect(state.nozzle(1)?.state).toBe("dispensing");
  });

  it("บันทึกเหตุการณ์จากหัวจ่ายที่ไม่มีในสาขาเป็นความผิดปกติ", () => {
    const state = newState();
    const result = state.apply({
      type: "state",
      nozzleId: 99,
      state: "authorized",
      at: at(0),
    });

    expect(result.applied).toBe(false);
    expect(result.anomalies[0]?.kind).toBe("unknown_nozzle");
  });

  it("รับ fault จากตู้แล้วรายงานต่อโดยไม่กระทบสถานะหัวจ่าย", () => {
    const state = newState();
    const result = state.apply({
      type: "fault",
      nozzleId: 3,
      message: "เชื่อมต่อตู้จ่าย 03 ไม่ได้",
      at: at(0),
    });

    expect(result.applied).toBe(true);
    expect(result.anomalies[0]).toMatchObject({
      kind: "device_fault",
      nozzleId: 3,
    });
    expect(state.nozzle(3)?.state).toBe("idle");
  });
});

describe("การจองรายการค้างชำระ", () => {
  // PRD 13.2 ข้อ 3 — เครื่อง POS สองเครื่องกดเก็บเงินหัวจ่ายเดียวกันพร้อมกัน
  // ต้องมีเครื่องเดียวที่สำเร็จ
  it("มีเครื่องเดียวที่จองสำเร็จเมื่อสองเครื่องแย่งกัน", () => {
    const state = newState();
    dispense(state, {
      nozzleId: 1,
      meterStart: 1_000,
      liters: 18,
      unitPrice: 38.69,
      second: 0,
    });

    const first = state.claim({ nozzleId: 1, terminalId: "POS-1" });
    const second = state.claim({ nozzleId: 1, terminalId: "POS-2" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("already_claimed");
      expect(second.claimedByTerminal).toBe("POS-1");
      expect(second.message).toContain("POS-1");
    }
  });

  it("ยังมีผู้ชนะเพียงรายเดียวเมื่อคำขอเข้ามาพร้อมกันแบบ concurrent", async () => {
    const state = newState();
    dispense(state, {
      nozzleId: 1,
      meterStart: 1_000,
      liters: 18,
      unitPrice: 38.69,
      second: 0,
    });

    const terminals = ["POS-1", "POS-2", "POS-3", "POS-4", "POS-5"];
    const results = await Promise.all(
      terminals.map(async terminalId => {
        await Promise.resolve();
        return state.claim({ nozzleId: 1, terminalId });
      })
    );

    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.filter(r => !r.ok)).toHaveLength(terminals.length - 1);
  });

  it("เครื่องเดิมจองซ้ำได้ เพื่อไม่ให้เน็ตกระตุกแล้วยิงซ้ำกลายเป็น error", () => {
    const state = newState();
    dispense(state, {
      nozzleId: 1,
      meterStart: 1_000,
      liters: 18,
      unitPrice: 38.69,
      second: 0,
    });

    const first = state.claim({ nozzleId: 1, terminalId: "POS-1" });
    const retry = state.claim({ nozzleId: 1, terminalId: "POS-1" });

    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(true);
    if (first.ok && retry.ok) {
      expect(retry.delivery.id).toBe(first.delivery.id);
    }
  });

  it("คืนการจองเมื่อบิลถูกยกเลิก แล้วเครื่องอื่นเก็บเงินต่อได้", () => {
    const state = newState();
    dispense(state, {
      nozzleId: 1,
      meterStart: 1_000,
      liters: 18,
      unitPrice: 38.69,
      second: 0,
    });

    const claimed = state.claim({ nozzleId: 1, terminalId: "POS-1" });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    expect(state.releaseClaim(1, claimed.delivery.id)).toBe(true);

    const retaken = state.claim({ nozzleId: 1, terminalId: "POS-2" });
    expect(retaken.ok).toBe(true);
  });

  it("บอกให้ชัดเมื่อหัวจ่ายไม่มีรายการรอชำระ", () => {
    const state = newState();
    const result = state.claim({ nozzleId: 1, terminalId: "POS-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("nothing_pending");
      expect(result.message).toContain("ไม่มีรายการรอชำระ");
    }
  });

  it("เก็บหลายรายการค้างที่หัวเดียวกันเป็นคิว และเก็บเงินทีละรายการ", () => {
    // M1-07 — รองรับหลายรายการค้างชำระที่หัวจ่ายเดียวกัน
    const state = newState();
    dispense(state, {
      nozzleId: 1,
      meterStart: 1_000,
      liters: 18,
      unitPrice: 38.69,
      second: 0,
    });
    state.apply({ type: "state", nozzleId: 1, state: "idle", at: at(60) });
    dispense(state, {
      nozzleId: 1,
      meterStart: 1_018,
      liters: 25,
      unitPrice: 38.69,
      second: 90,
    });

    const queue = state.nozzle(1)!.pendingDeliveries;
    expect(queue).toHaveLength(2);
    // คิวเรียงเก่าไปใหม่ — รายการแรกต้องถูกเก็บเงินก่อน
    expect(queue[0]!.liters).toBe(18);
    expect(queue[1]!.liters).toBe(25);

    const claim = state.claim({ nozzleId: 1, terminalId: "POS-1" });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.delivery.liters).toBe(18);

    state.settle(1, claim.delivery.id);
    // ยังค้างอีกหนึ่งรายการ จึงยังต้องขึ้น "รอชำระเงิน" ต่อไป
    expect(state.nozzle(1)?.state).toBe("pending_payment");
    expect(state.nozzle(1)?.pendingDeliveries).toHaveLength(1);

    const next = state.claim({ nozzleId: 1, terminalId: "POS-2" });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.delivery.liters).toBe(25);

    state.settle(1, next.delivery.id);
    expect(state.nozzle(1)?.state).toBe("idle");
  });

  it("จองรายการที่ระบุเจาะจงในคิวได้", () => {
    const state = newState();
    dispense(state, {
      nozzleId: 1,
      meterStart: 1_000,
      liters: 18,
      unitPrice: 38.69,
      second: 0,
    });
    state.apply({ type: "state", nozzleId: 1, state: "idle", at: at(60) });
    dispense(state, {
      nozzleId: 1,
      meterStart: 1_018,
      liters: 25,
      unitPrice: 38.69,
      second: 90,
    });

    const second = state.nozzle(1)!.pendingDeliveries[1]!;
    const claim = state.claim({
      nozzleId: 1,
      terminalId: "POS-1",
      deliveryId: second.id,
    });

    expect(claim.ok).toBe(true);
    if (claim.ok) expect(claim.delivery.liters).toBe(25);
  });
});

describe("การตรวจจับความผิดปกติ", () => {
  it("แจ้งเมื่อลิตรที่ตู้รายงานไม่ตรงกับส่วนต่างเลขมิเตอร์", () => {
    // PRD 9.3 — ปริมาณน้ำมันต้องตรงกับส่วนต่างเลขมิเตอร์เสมอ
    const state = newState();
    state.authorize(1);
    state.apply({
      type: "delivery_started",
      nozzleId: 1,
      meterStart: 1_000,
      unitPrice: 38.69,
      at: at(0),
    });

    const result = state.apply({
      type: "delivery_completed",
      nozzleId: 1,
      liters: 18,
      amount: 696.42,
      meterEnd: 1_030, // ส่วนต่างจริง 30 ลิตร ไม่ใช่ 18
      at: at(30),
    });

    expect(result.applied).toBe(true);
    const mismatch = result.anomalies.find(a => a.kind === "meter_mismatch");
    expect(mismatch).toBeDefined();
    expect(mismatch?.message).toContain("30.000");
    // ยังบันทึกรายการไว้ให้เก็บเงิน แต่ติดธงให้ตรวจสอบ
    expect(state.nozzle(1)?.pendingDeliveries).toHaveLength(1);
  });

  it("ยอมรับส่วนต่างเล็กน้อยจากการปัดเศษของตู้แต่ละยี่ห้อ", () => {
    const state = newState();
    state.authorize(1);
    state.apply({
      type: "delivery_started",
      nozzleId: 1,
      meterStart: 1_000,
      unitPrice: 38.69,
      at: at(0),
    });

    const result = state.apply({
      type: "delivery_completed",
      nozzleId: 1,
      liters: 18,
      amount: 696.42,
      meterEnd: 1_018.01,
      at: at(30),
    });

    expect(
      result.anomalies.find(a => a.kind === "meter_mismatch")
    ).toBeUndefined();
  });

  it("แจ้งเมื่อจ่ายเกินเกณฑ์ต่อรายการ", () => {
    // M1-09 — เช่น จ่ายเกิน 200 ลิตรต่อรายการ
    const state = newState();
    const liters = OVERSIZED_DELIVERY_LITERS + 50;
    const result = dispense(state, {
      nozzleId: 1,
      meterStart: 1_000,
      liters,
      unitPrice: 38.69,
      second: 0,
    });

    const oversized = result.anomalies.find(
      a => a.kind === "oversized_delivery"
    );
    expect(oversized).toBeDefined();
    expect(oversized?.message).toContain("เกินเกณฑ์");
    // ยังขายได้ตามปกติ แค่ต้องถูกบันทึกไว้
    expect(state.nozzle(1)?.pendingDeliveries).toHaveLength(1);
  });
});

describe("การเปลี่ยนราคาขณะมีหัวจ่ายทำงานอยู่", () => {
  // PRD 13.2 ข้อ 4 / M7-04
  it("บล็อกการเปลี่ยนราคาเมื่อมีหัวจ่ายชนิดเดียวกันกำลังจ่ายอยู่", () => {
    const state = newState();
    state.authorize(1);
    state.apply({
      type: "delivery_started",
      nozzleId: 1,
      meterStart: 1_000,
      unitPrice: 38.69,
      at: at(0),
    });

    const blockers = findPriceChangeBlockers(state.snapshot().nozzles, "GSH95");
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.label).toBe("ตู้ 1 หัว A");
    expect(priceChangeBlockedMessage(blockers)).toContain("ตู้ 1 หัว A");
    expect(priceChangeBlockedMessage(blockers)).toContain("รอจนจบรายการ");

    // น้ำมันคนละชนิดไม่โดนบล็อก
    expect(
      findPriceChangeBlockers(state.snapshot().nozzles, "DB7")
    ).toHaveLength(0);
  });

  it("ไม่บล็อกเมื่อหัวจ่ายแค่รอชำระเงิน เพราะราคาถูกล็อกไปแล้ว", () => {
    const state = newState();
    dispense(state, {
      nozzleId: 1,
      meterStart: 1_000,
      liters: 18,
      unitPrice: 38.69,
      second: 0,
    });

    expect(state.nozzle(1)?.state).toBe("pending_payment");
    expect(
      findPriceChangeBlockers(state.snapshot().nozzles, "GSH95")
    ).toHaveLength(0);
  });

  it("รายการที่เปิดค้างไว้ยังใช้ราคาเดิม แม้ราคาบนหัวจ่ายถูกเปลี่ยนไปแล้ว", () => {
    const state = newState();
    state.authorize(1);
    state.apply({
      type: "delivery_started",
      nozzleId: 1,
      meterStart: 1_000,
      unitPrice: 38.69,
      at: at(0),
    });

    state.setPrice(1, 41.5);

    expect(state.nozzle(1)?.unitPrice).toBe(41.5);
    expect(state.nozzle(1)?.activeDelivery?.unitPrice).toBe(38.69);
  });
});

describe("การปิดกะขณะมีรายการค้าง", () => {
  // PRD 13.2 ข้อ 8 — ต้องบล็อกและระบุว่าค้างที่หัวไหน
  it("บล็อกการปิดกะและบอกชื่อหัวจ่ายที่ค้าง", () => {
    const state = newState();
    dispense(state, {
      nozzleId: 2,
      meterStart: 1_000,
      liters: 40,
      unitPrice: 32.94,
      second: 0,
    });

    const unsettled = findUnsettledNozzles(state.snapshot().nozzles);
    expect(unsettled).toHaveLength(1);
    expect(shiftCloseBlockedMessage(unsettled)).toContain("ตู้ 1 หัว B");
    expect(shiftCloseBlockedMessage(unsettled)).toContain("ปิดกะไม่ได้");
  });

  it("นับหัวจ่ายที่กำลังจ่ายอยู่ว่ายังค้างด้วย", () => {
    const state = newState();
    state.authorize(3);
    state.apply({
      type: "delivery_started",
      nozzleId: 3,
      meterStart: 1_000,
      unitPrice: 38.69,
      at: at(0),
    });

    expect(findUnsettledNozzles(state.snapshot().nozzles)).toHaveLength(1);
  });

  it("ปล่อยให้ปิดกะได้เมื่อเก็บเงินครบทุกหัวแล้ว", () => {
    const state = newState();
    dispense(state, {
      nozzleId: 1,
      meterStart: 1_000,
      liters: 18,
      unitPrice: 38.69,
      second: 0,
    });
    const pending = state.nozzle(1)!.pendingDeliveries[0]!;
    state.settle(1, pending.id);

    expect(findUnsettledNozzles(state.snapshot().nozzles)).toHaveLength(0);
  });
});

describe("ภาพรวมลานจ่าย", () => {
  it("เรียงหัวจ่ายตามเกาะจ่ายจริง เพื่อให้ผังบนจอตรงกับผังหน้างาน", () => {
    const state = createForecourtState([
      {
        nozzleId: 7,
        islandNo: 2,
        label: "ตู้ 2 หัว B",
        fuelLabel: "DB7",
        unitPrice: 32.94,
      },
      {
        nozzleId: 1,
        islandNo: 1,
        label: "ตู้ 1 หัว A",
        fuelLabel: "GSH95",
        unitPrice: 38.69,
      },
      {
        nozzleId: 4,
        islandNo: 2,
        label: "ตู้ 2 หัว A",
        fuelLabel: "GSH95",
        unitPrice: 38.69,
      },
    ]);

    expect(state.snapshot().nozzles.map(n => n.nozzleId)).toEqual([1, 4, 7]);
  });

  it("หัวจ่ายที่ปิดใช้งานเริ่มต้นด้วยสถานะปิดใช้งาน และอนุญาตให้จ่ายไม่ได้", () => {
    const state = createForecourtState([
      {
        nozzleId: 1,
        islandNo: 1,
        label: "ตู้ 1 หัว A",
        fuelLabel: "GSH95",
        unitPrice: 38.69,
        active: false,
      },
    ]);

    expect(state.nozzle(1)?.state).toBe("disabled");
    const result = state.authorize(1);
    expect(result.applied).toBe(false);
    expect(result.anomalies[0]?.kind).toBe("illegal_transition");
  });

  it("คืนสำเนาของสถานะ ไม่ใช่ตัวอ้างอิงที่แก้ไขจากภายนอกได้", () => {
    const state = newState();
    dispense(state, {
      nozzleId: 1,
      meterStart: 1_000,
      liters: 18,
      unitPrice: 38.69,
      second: 0,
    });

    const snapshot = state.snapshot();
    snapshot.nozzles[0]!.pendingDeliveries[0]!.amount = 1;

    expect(state.nozzle(1)?.pendingDeliveries[0]?.amount).toBe(696.42);
  });
});

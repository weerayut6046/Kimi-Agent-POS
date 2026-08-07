import { beforeEach, describe, expect, it } from "vitest";
import { createAtgSimulator, createForecourtSimulator } from "./simulator";
import { createForecourtState } from "./state";
import type { ForecourtEvent } from "@contracts/forecourt";

const NOZZLES = [
  {
    nozzleId: 1,
    label: "ตู้ 1 หัว A",
    fuelLabel: "GSH95",
    unitPrice: 38.69,
    startMeter: 397_079.76,
    startMoney: 8_478_563.1,
  },
  {
    nozzleId: 2,
    label: "ตู้ 1 หัว B",
    fuelLabel: "DB7",
    unitPrice: 32.94,
    startMeter: 100_000,
  },
] as const;

function newSimulator() {
  return createForecourtSimulator({ nozzles: [...NOZZLES] });
}

describe("ตัวจำลองตู้จ่าย", () => {
  let sim: ReturnType<typeof newSimulator>;
  let events: ForecourtEvent[];

  beforeEach(async () => {
    sim = newSimulator();
    events = [];
    sim.subscribe(event => events.push(event));
    await sim.start();
  });

  it("จ่ายน้ำมันครบหนึ่งรายการแบบ post-pay", async () => {
    expect(await sim.authorize(1, { kind: "none" })).toEqual({ ok: true });
    sim.liftNozzle(1);
    sim.advance(30); // 0.6 ลิตร/วินาที × 30 วินาที = 18 ลิตร
    sim.hangUpNozzle(1);

    expect(events.map(e => e.type)).toEqual([
      "state",
      "delivery_started",
      "delivery_progress",
      "delivery_completed",
    ]);

    const started = events[1];
    const completed = events[3];
    expect(started).toMatchObject({
      meterStart: 397_079.76,
      unitPrice: 38.69,
    });
    expect(completed).toMatchObject({
      liters: 18,
      amount: 696.42,
      meterEnd: 397_097.76,
    });
  });

  it("ไม่ให้ยกหัวจ่ายก่อนได้รับอนุญาต", () => {
    sim.liftNozzle(1);
    sim.advance(30);

    expect(events).toHaveLength(0);
  });

  it("ปฏิเสธการอนุญาตซ้ำขณะยังมีรายการค้างชำระ", async () => {
    await sim.authorize(1, { kind: "none" });
    sim.liftNozzle(1);
    sim.advance(10);
    sim.hangUpNozzle(1);

    const second = await sim.authorize(1, { kind: "none" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.message).toContain("ตู้ 1 หัว A");

    // เคลียร์หัวจ่ายหลังเก็บเงินแล้ว จึงอนุญาตได้อีกครั้ง
    sim.resetNozzle(1);
    expect(await sim.authorize(1, { kind: "none" })).toEqual({ ok: true });
  });

  it("ตัดการจ่ายเองเมื่อถึงยอดเงินที่ตั้งไว้ล่วงหน้า", async () => {
    // M1-04 — โหมดจ่ายเงินก่อนเติมแบบระบุจำนวนเงิน
    await sim.authorize(1, { kind: "amount", baht: 500 });
    sim.liftNozzle(1);
    sim.advance(60); // ถ้าไม่มี preset จะได้ 36 ลิตร

    const completed = events.find(e => e.type === "delivery_completed");
    expect(completed).toBeDefined();
    if (completed?.type !== "delivery_completed") return;

    expect(completed.amount).toBeLessThanOrEqual(500);
    expect(completed.amount).toBeGreaterThan(499);
    expect(completed.liters).toBeCloseTo(500 / 38.69, 2);
  });

  it("ตัดการจ่ายเองเมื่อถึงจำนวนลิตรที่ตั้งไว้ล่วงหน้า", async () => {
    await sim.authorize(1, { kind: "volume", liters: 20 });
    sim.liftNozzle(1);
    sim.advance(60);

    const completed = events.find(e => e.type === "delivery_completed");
    if (completed?.type !== "delivery_completed")
      throw new Error("ไม่พบรายการที่จบ");

    expect(completed.liters).toBe(20);
    expect(completed.amount).toBe(773.8);
  });

  it("หยุดหัวจ่ายกลางคันแล้วคิดเงินเท่าที่จ่ายไปจริง", async () => {
    await sim.authorize(1, { kind: "none" });
    sim.liftNozzle(1);
    sim.advance(10); // 6 ลิตร

    expect(await sim.stopNozzle(1)).toEqual({ ok: true });

    const completed = events.find(e => e.type === "delivery_completed");
    if (completed?.type !== "delivery_completed")
      throw new Error("ไม่พบรายการที่จบ");
    expect(completed.liters).toBe(6);
    expect(completed.amount).toBe(232.14);
  });

  it("ยกเลิกการอนุญาตได้เมื่อลูกค้าเปลี่ยนใจก่อนยกหัวจ่าย", async () => {
    await sim.authorize(1, { kind: "none" });
    await sim.stopNozzle(1);

    expect(events.map(e => e.type)).toEqual(["state", "state"]);
    expect(await sim.authorize(1, { kind: "none" })).toEqual({ ok: true });
  });

  it("ไม่รับราคาใหม่ขณะกำลังจ่าย และรับได้เมื่อจบรายการ", async () => {
    // M7-04 — ห้ามเปลี่ยนราคาขณะที่มีหัวจ่ายกำลังจ่ายอยู่
    await sim.authorize(1, { kind: "none" });
    sim.liftNozzle(1);
    sim.advance(10);

    const rejected = await sim.setPrice(1, 41.5);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.message).toContain("กำลังจ่ายอยู่");
      expect(rejected.message).toContain("รอจนจบรายการ");
    }

    sim.hangUpNozzle(1);
    expect(await sim.setPrice(1, 41.5)).toEqual({ ok: true });
  });

  it("อ่านมิเตอร์สะสมได้ตรงกับที่จ่ายไป", async () => {
    // M4-02 — อ่านค่ามิเตอร์ตู้จ่ายอัตโนมัติ ณ เวลาเปิด/ปิดกะ
    const opening = await sim.readMeters();
    expect(opening.find(m => m.nozzleId === 1)).toMatchObject({
      totalLiters: 397_079.76,
      totalMoney: 8_478_563.1,
    });

    await sim.authorize(1, { kind: "none" });
    sim.liftNozzle(1);
    sim.advance(30);
    sim.hangUpNozzle(1);

    const closing = await sim.readMeters();
    expect(closing.find(m => m.nozzleId === 1)).toMatchObject({
      totalLiters: 397_097.76,
      totalMoney: 8_479_259.52,
    });
    // หัวที่ไม่ได้จ่ายต้องไม่ขยับ
    expect(closing.find(m => m.nozzleId === 2)?.totalLiters).toBe(100_000);
  });

  it("มิเตอร์เดินต่อเนื่องข้ามหลายรายการ", async () => {
    for (const seconds of [30, 20]) {
      await sim.authorize(1, { kind: "none" });
      sim.liftNozzle(1);
      sim.advance(seconds);
      sim.hangUpNozzle(1);
      sim.resetNozzle(1);
    }

    const completions = events.filter(e => e.type === "delivery_completed");
    expect(completions).toHaveLength(2);
    if (
      completions[0]?.type !== "delivery_completed" ||
      completions[1]?.type !== "delivery_completed"
    ) {
      throw new Error("ไม่พบรายการที่จบ");
    }

    expect(completions[0].meterEnd).toBe(397_097.76);
    expect(completions[1].liters).toBe(12);
    expect(completions[1].meterEnd).toBe(397_109.76);
  });

  it("หยุดส่งเหตุการณ์เมื่อสั่งหยุด driver", async () => {
    await sim.stop();
    await sim.authorize(1, { kind: "none" });

    expect(events).toHaveLength(0);
  });
});

describe("ตัวจำลองต่อกับสถานะลานจ่าย", () => {
  function wire() {
    const sim = newSimulator();
    const state = createForecourtState([
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
    ]);
    const anomalies: string[] = [];
    sim.subscribe(event => {
      const result = state.apply(event);
      for (const anomaly of result.anomalies) anomalies.push(anomaly.kind);
    });
    return { sim, state, anomalies };
  }

  it("สถานะบนหน้าจอตามการจ่ายจริงตั้งแต่ต้นจนจบ", async () => {
    const { sim, state, anomalies } = wire();
    await sim.start();

    await sim.authorize(1, { kind: "none" });
    expect(state.nozzle(1)?.state).toBe("authorized");

    sim.liftNozzle(1);
    expect(state.nozzle(1)?.state).toBe("dispensing");

    sim.advance(15);
    expect(state.nozzle(1)?.activeDelivery?.liters).toBe(9);

    sim.advance(15);
    sim.hangUpNozzle(1);

    const nozzle = state.nozzle(1)!;
    expect(nozzle.state).toBe("pending_payment");
    expect(nozzle.pendingDeliveries[0]).toMatchObject({
      liters: 18,
      amount: 696.42,
      meterStart: 397_079.76,
      meterEnd: 397_097.76,
    });
    // เดินครบรอบโดยไม่มีความผิดปกติเลย
    expect(anomalies).toEqual([]);

    const claim = state.claim({ nozzleId: 1, terminalId: "POS-1" });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;

    state.settle(1, claim.delivery.id);
    sim.resetNozzle(1);
    expect(state.nozzle(1)?.state).toBe("idle");
  });

  it("ลิตรที่รายงานตรงกับส่วนต่างมิเตอร์เสมอ จึงไม่มีการแจ้งผิดปกติ", async () => {
    const { sim, state, anomalies } = wire();
    await sim.start();

    for (const nozzleId of [1, 2]) {
      await sim.authorize(nozzleId, { kind: "none" });
      sim.liftNozzle(nozzleId);
      sim.advance(25);
      sim.hangUpNozzle(nozzleId);
    }

    expect(anomalies).toEqual([]);
    for (const nozzleId of [1, 2]) {
      const delivery = state.nozzle(nozzleId)!.pendingDeliveries[0]!;
      expect(delivery.meterEnd! - delivery.meterStart).toBeCloseTo(
        delivery.liters,
        3
      );
    }
  });

  it("ระบบไม่ล่มเมื่อตู้จ่ายส่งข้อมูลผิดรูปแบบกลางรายการ", async () => {
    // PRD 13.2 ข้อ 9
    const { sim, state, anomalies } = wire();
    await sim.start();

    await sim.authorize(1, { kind: "none" });
    sim.liftNozzle(1);
    sim.advance(10);

    expect(() => {
      sim.emitRaw({
        type: "delivery_progress",
        nozzleId: 1,
        liters: "เยอะมาก",
      });
      sim.emitRaw(" ÿ ข้อมูลจากสายที่สัญญาณรบกวน");
      sim.emitRaw(null);
    }).not.toThrow();

    expect(anomalies.filter(kind => kind === "invalid_event")).toHaveLength(3);
    // รายการที่กำลังจ่ายยังอยู่ครบและจ่ายต่อได้
    expect(state.nozzle(1)?.state).toBe("dispensing");
    expect(state.nozzle(1)?.activeDelivery?.liters).toBe(6);

    sim.advance(20);
    sim.hangUpNozzle(1);
    expect(state.nozzle(1)?.pendingDeliveries[0]?.liters).toBe(18);
  });
});

describe("ตัวจำลองเกจวัดถัง", () => {
  function newAtg() {
    return createAtgSimulator({
      tanks: [
        { tankId: 1, capacityLiters: 30_000, volumeLiters: 18_500 },
        {
          tankId: 2,
          capacityLiters: 30_000,
          volumeLiters: 9_000,
          waterLiters: 12,
        },
      ],
    });
  }

  it("รายงานปริมาตร อุณหภูมิ ระดับน้ำ และพื้นที่ว่าง", async () => {
    // M6-01 — อ่านระดับน้ำมัน อุณหภูมิ และระดับน้ำในถัง
    const atg = newAtg();
    const readings = await atg.readAll();

    expect(readings[0]).toMatchObject({
      tankId: 1,
      volumeLiters: 18_500,
      waterLiters: 0,
      temperatureC: 30,
      ullageLiters: 11_500,
    });
    expect(readings[1]?.waterLiters).toBe(12);
  });

  it("ส่งค่าให้ผู้ติดตามทุกรอบการอ่าน", async () => {
    const atg = newAtg();
    const seen: number[] = [];
    const unsubscribe = atg.subscribe(reading => seen.push(reading.tankId));

    await atg.start();
    atg.poll();
    expect(seen).toEqual([1, 2]);

    unsubscribe();
    atg.poll();
    expect(seen).toEqual([1, 2]);
  });

  it("ระดับลดลงเมื่อจ่ายออก และเพิ่มขึ้นเมื่อรถน้ำมันมาลง", async () => {
    const atg = newAtg();
    atg.drain(1, 1_250.5);
    expect((await atg.readAll())[0]?.volumeLiters).toBe(17_249.5);

    atg.fill(1, 10_000);
    expect((await atg.readAll())[0]?.volumeLiters).toBe(27_249.5);
  });

  it("ไม่ให้ปริมาตรต่ำกว่าศูนย์หรือเกินความจุถัง", async () => {
    const atg = newAtg();
    atg.drain(1, 99_999);
    expect((await atg.readAll())[0]?.volumeLiters).toBe(0);

    atg.fill(1, 99_999);
    expect((await atg.readAll())[0]).toMatchObject({
      volumeLiters: 30_000,
      ullageLiters: 0,
    });
  });

  it("ตั้งระดับน้ำในถังเพื่อทดสอบการแจ้งเตือนได้", async () => {
    // M6-03 — แจ้งเตือนเมื่อพบน้ำในถังเกินเกณฑ์
    const atg = newAtg();
    atg.setWater(1, 45);

    expect((await atg.readAll())[0]?.waterLiters).toBe(45);
  });
});

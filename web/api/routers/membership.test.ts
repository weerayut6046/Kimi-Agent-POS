import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { members, rewards } from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทสสมาชิกสะสมแต้ม บนฐานข้อมูลชั่วคราว (migrate + seed)
// seed: M0001 = 320 แต้ม, M0002 = 85 แต้ม; รางวัล "น้ำดื่ม 1 ขวด" = 30 แต้ม สต๊อก 100
let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.cleanup());

const memberByCode = async (code: string) =>
  (await t.db.query.members.findFirst({ where: eq(members.memberCode, code) }))!;
const rewardByName = async (name: string) =>
  (await t.db.query.rewards.findFirst({ where: eq(rewards.name, name) }))!;

describe("createMember", () => {
  it("สมัครสมาชิกใหม่ ออกรหัส running ต่อจากที่มี", async () => {
    const res = await t.caller().membership.createMember({ name: "ทดสอบ ใหม่", phone: "0800000001" });
    expect(res.memberCode).toBe("M0004"); // seed มี 3 คน
    expect((await memberByCode("M0004")).points).toBe(0);
  });

  it("เบอร์ซ้ำ → error", async () => {
    await expect(
      t.caller().membership.createMember({ name: "ซ้ำ", phone: "0812345678" }), // เบอร์ของ M0001
    ).rejects.toThrow("เบอร์นี้สมัครสมาชิกแล้ว");
  });
});

describe("adjustPoints", () => {
  it("admin ปรับแต้มและบันทึก transaction", async () => {
    const m = await memberByCode("M0002"); // 85 แต้ม
    const res = await t.caller("admin").membership.adjustPoints({
      memberId: m.id,
      points: 50,
      note: "ชดเชยระบบล่ม",
    });
    expect(res.points).toBe(135);

    const txns = await t.caller().membership.memberTransactions({ memberId: m.id });
    expect(txns[0]).toMatchObject({ type: "adjust", points: 50, note: "ชดเชยระบบล่ม" });
  });

  it("ปรับจนติดลบ → error", async () => {
    const m = await memberByCode("M0002");
    await expect(
      t.caller("admin").membership.adjustPoints({ memberId: m.id, points: -9999, note: "ลบเกิน" }),
    ).rejects.toThrow("แต้มติดลบไม่ได้");
  });

  it("cashier ปรับแต้มไม่ได้ (สงวนสิทธิ์ admin)", async () => {
    const m = await memberByCode("M0002");
    await expect(
      t.caller("cashier").membership.adjustPoints({ memberId: m.id, points: 10, note: "x" }),
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });
});

describe("redeemReward", () => {
  it("แลกรางวัลสำเร็จ: หักแต้ม หักสต๊อก และบันทึกประวัติ", async () => {
    const m = await memberByCode("M0001"); // 320 แต้ม
    const rw = await rewardByName("น้ำดื่ม 1 ขวด"); // 30 แต้ม, สต๊อก 100

    const res = await t.caller().membership.redeemReward({ memberId: m.id, rewardId: rw.id });

    expect(res.pointsLeft).toBe(290);
    expect((await rewardByName("น้ำดื่ม 1 ขวด")).stock).toBe(rw.stock - 1);

    const history = await t.caller().membership.redemptionHistory();
    expect(history[0]).toMatchObject({ memberId: m.id, rewardId: rw.id, pointsUsed: 30 });

    const txns = await t.caller().membership.memberTransactions({ memberId: m.id });
    expect(txns[0]).toMatchObject({ type: "redeem", points: -30 });
  });

  it("แต้มไม่พอ → error", async () => {
    const m = await memberByCode("M0002"); // 135 แต้ม
    const rw = await rewardByName("ส่วนลด 100 บาท"); // 450 แต้ม
    await expect(
      t.caller().membership.redeemReward({ memberId: m.id, rewardId: rw.id }),
    ).rejects.toThrow("แต้มไม่พอ");
  });

  it("ของรางวัลหมดสต๊อก → error", async () => {
    const m = await memberByCode("M0001");
    await t.caller("admin").membership.upsertReward({ name: "ของหมด", pointsRequired: 10, stock: 0 });
    const rw = await rewardByName("ของหมด");
    await expect(
      t.caller().membership.redeemReward({ memberId: m.id, rewardId: rw.id }),
    ).rejects.toThrow("ของรางวัลหมด");
  });
});

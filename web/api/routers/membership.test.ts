import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { memberCards, members, pointTransactions, rewards } from "@db/schema";
import { generateMemberCode, isLongMemberCode } from "@contracts/memberCode";
import { setupTestDb, type TestDb } from "../test/testDb";

// เทสสมาชิกสะสมแต้ม บนฐานข้อมูลชั่วคราว (migrate + seed)
// seed: M0001 = 320 แต้ม, M0002 = 85 แต้ม; รางวัล "น้ำดื่ม 1 ขวด" = 30 แต้ม สต๊อก 100
let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.cleanup());

const memberByCode = async (code: string) =>
  (await t.db.query.members.findFirst({
    where: eq(members.memberCode, code),
  }))!;
const rewardByName = async (name: string) =>
  (await t.db.query.rewards.findFirst({ where: eq(rewards.name, name) }))!;

describe("createMember", () => {
  it("สมัครสมาชิกใหม่และออกรหัสเลข 16 หลักให้อัตโนมัติ", async () => {
    const res = await t
      .caller()
      .membership.createMember({ name: "ทดสอบ ใหม่", phone: "0800000001" });
    expect(isLongMemberCode(res.memberCode)).toBe(true);
    expect((await memberByCode(res.memberCode)).points).toBe(0);
    expect(
      await t.db.query.memberCards.findFirst({
        where: eq(memberCards.memberCode, res.memberCode),
      })
    ).toMatchObject({ status: "activated", activatedMemberId: res.id });
  });

  it("เบอร์ซ้ำ → error", async () => {
    await expect(
      t.caller().membership.createMember({ name: "ซ้ำ", phone: "0812345678" }) // เบอร์ของ M0001
    ).rejects.toThrow("เบอร์นี้สมัครสมาชิกแล้ว");
  });

  it("เปิดใช้บัตรใหม่จากเลขที่เครื่องอ่านส่งมา", async () => {
    const cardCode = generateMemberCode();
    const before = await t.caller().membership.checkCardAvailability({
      cardCode,
    });
    expect(before).toEqual({ cardCode, valid: true, available: true });

    const res = await t.caller().membership.createMember({
      name: "สมาชิกจากบัตร",
      phone: "0800000002",
      cardCode: `;${cardCode}=9912101?`,
    });
    expect(res.memberCode).toBe(cardCode);

    const after = await t.caller().membership.checkCardAvailability({
      cardCode,
    });
    expect(after).toEqual({ cardCode, valid: true, available: false });
  });

  it("ไม่เปิดใช้บัตรซ้ำ", async () => {
    const cardCode = generateMemberCode();
    await t.caller().membership.createMember({
      name: "บัตรใบแรก",
      phone: "0800000003",
      cardCode,
    });
    await expect(
      t.caller().membership.createMember({
        name: "บัตรใบเดิม",
        phone: "0800000004",
        cardCode,
      })
    ).rejects.toThrow("บัตรนี้เปิดใช้งานแล้ว");
  });

  it("ไม่รับเลขบัตรที่พิมพ์ผิด", async () => {
    await expect(
      t.caller().membership.createMember({
        name: "เลขผิด",
        phone: "0800000005",
        cardCode: "8812 3456 7890 1234",
      })
    ).rejects.toThrow("เลขบัตรไม่ถูกต้อง");
  });
});

describe("member card batches", () => {
  it("ผู้จัดการสร้างชุดบัตรเลข 16 หลักที่ลงทะเบียนเป็นบัตรยังไม่เปิดใช้งาน", async () => {
    const result = await t.caller("manager").membership.createCardBatch({
      quantity: 3,
      label: "ชุดทดสอบโรงพิมพ์",
    });

    expect(result.batch).toMatchObject({
      quantity: 3,
      label: "ชุดทดสอบโรงพิมพ์",
      branchId: 1,
    });
    expect(result.cards).toHaveLength(3);
    expect(new Set(result.cards.map(card => card.memberCode)).size).toBe(3);
    for (const card of result.cards) {
      expect(isLongMemberCode(card.memberCode)).toBe(true);
      expect(card.status).toBe("unused");
    }

    const before = await t.caller().membership.checkCardAvailability({
      cardCode: result.cards[0]!.memberCode,
    });
    expect(before.available).toBe(true);

    await t.caller().membership.createMember({
      name: "สมาชิกจากชุดบัตร",
      phone: "0800000010",
      cardCode: result.cards[0]!.memberCode,
    });
    const detail = await t.caller("manager").membership.getCardBatch({
      id: result.batch.id,
    });
    expect(detail.cards[0]).toMatchObject({ status: "activated" });

    const list = await t.caller("manager").membership.listCardBatches();
    expect(list[0]).toMatchObject({
      id: result.batch.id,
      total: 3,
      unused: 2,
      activated: 1,
    });
  });

  it("พนักงานแคชเชียร์ไม่มีสิทธิ์สร้างหรือเปิดดูชุดบัตร", async () => {
    await expect(
      t.caller("cashier").membership.createCardBatch({ quantity: 1 })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
    await expect(
      t.caller("cashier").membership.listCardBatches()
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });
});

describe("find member for POS", () => {
  it("ค้นหาจากรหัสสมาชิกบนบาร์โค้ดหรือ QR ได้", async () => {
    const rows = await t.caller().membership.findByPhone({ phone: "m0001" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ memberCode: "M0001", phone: "0812345678" });
  });
});

describe("customer loyalty lookup", () => {
  it("ให้ลูกค้าตรวจแต้มและประวัติด้วยเบอร์โทรได้โดยไม่ต้องมี session", async () => {
    const memberCode = generateMemberCode();
    const [member] = await t.db
      .insert(members)
      .values({
        memberCode,
        name: "มานี ทดสอบระบบ",
        phone: "+66 89-123-4567",
        points: 42,
        tier: "gold",
      })
      .returning();
    await t.db.insert(pointTransactions).values(
      Array.from({ length: 12 }, (_, index) => ({
        branchId: 1,
        memberId: member!.id,
        type: index % 3 === 0 ? ("redeem" as const) : ("earn" as const),
        points: index % 3 === 0 ? -2 : 5,
        note: `รายการทดสอบ ${index + 1}`,
      }))
    );

    const first = await t.anonymousCaller().membership.customerPoints({
      phone: "0891234567",
      limit: 10,
    });

    expect(first.member).toMatchObject({
      maskedName: "มา***",
      maskedPhone: "xxx-xxx-4567",
      points: 42,
      tier: "gold",
      expired: false,
    });
    expect(first.member).not.toHaveProperty("name");
    expect(first.member).not.toHaveProperty("phone");
    expect(first.summary).toEqual({
      transactionCount: 12,
      totalEarned: 40,
      totalUsed: 8,
    });
    expect(first.transactions).toHaveLength(10);
    expect(first.nextCursor).toEqual(expect.any(Number));

    const second = await t.anonymousCaller().membership.customerPoints({
      phone: "+66 89 123 4567",
      limit: 10,
      cursor: first.nextCursor!,
    });
    expect(second.transactions).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  it("ไม่ส่งข้อมูลสมาชิกเมื่อเบอร์โทรไม่ตรง", async () => {
    const result = await t.anonymousCaller().membership.customerPoints({
      phone: "0809999999",
      limit: 10,
    });
    expect(result).toEqual({
      member: null,
      summary: null,
      transactions: [],
      nextCursor: null,
    });
  });

  it("ปฏิเสธรูปแบบเบอร์โทรที่ไม่ถูกต้อง", async () => {
    await expect(
      t.anonymousCaller().membership.customerPoints({
        phone: "1234",
        limit: 10,
      })
    ).rejects.toThrow("กรุณากรอกเบอร์โทรศัพท์สมาชิกให้ถูกต้อง");
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

    const txns = await t
      .caller()
      .membership.memberTransactions({ memberId: m.id });
    expect(txns[0]).toMatchObject({
      type: "adjust",
      points: 50,
      note: "ชดเชยระบบล่ม",
    });
  });

  it("ปรับจนติดลบ → error", async () => {
    const m = await memberByCode("M0002");
    await expect(
      t.caller("admin").membership.adjustPoints({
        memberId: m.id,
        points: -9999,
        note: "ลบเกิน",
      })
    ).rejects.toThrow("แต้มติดลบไม่ได้");
  });

  it("cashier ปรับแต้มไม่ได้ (สงวนสิทธิ์ admin)", async () => {
    const m = await memberByCode("M0002");
    await expect(
      t
        .caller("cashier")
        .membership.adjustPoints({ memberId: m.id, points: 10, note: "x" })
    ).rejects.toThrow("สิทธิ์ไม่เพียงพอ");
  });
});

describe("redeemReward", () => {
  it("แลกรางวัลสำเร็จ: หักแต้ม หักสต๊อก และบันทึกประวัติ", async () => {
    const m = await memberByCode("M0001"); // 320 แต้ม
    const rw = await rewardByName("น้ำดื่ม 1 ขวด"); // 30 แต้ม, สต๊อก 100

    const res = await t
      .caller()
      .membership.redeemReward({ memberId: m.id, rewardId: rw.id });

    expect(res.pointsLeft).toBe(290);
    expect((await rewardByName("น้ำดื่ม 1 ขวด")).stock).toBe(rw.stock - 1);

    const history = await t.caller().membership.redemptionHistory();
    expect(history[0]).toMatchObject({
      memberId: m.id,
      rewardId: rw.id,
      pointsUsed: 30,
    });

    const txns = await t
      .caller()
      .membership.memberTransactions({ memberId: m.id });
    expect(txns[0]).toMatchObject({ type: "redeem", points: -30 });
  });

  it("แต้มไม่พอ → error", async () => {
    const m = await memberByCode("M0002"); // 135 แต้ม
    const rw = await rewardByName("ส่วนลด 100 บาท"); // 450 แต้ม
    await expect(
      t.caller().membership.redeemReward({ memberId: m.id, rewardId: rw.id })
    ).rejects.toThrow("แต้มไม่พอ");
  });

  it("ของรางวัลหมดสต๊อก → error", async () => {
    const m = await memberByCode("M0001");
    await t.caller("admin").membership.upsertReward({
      name: "ของหมด",
      pointsRequired: 10,
      stock: 0,
    });
    const rw = await rewardByName("ของหมด");
    await expect(
      t.caller().membership.redeemReward({ memberId: m.id, rewardId: rw.id })
    ).rejects.toThrow("ของรางวัลหมด");
  });
});

describe("member card expiry", () => {
  it("ครบ 1 ปีแล้วตัดแต้มเป็นศูนย์ครั้งเดียว เก็บประวัติ และห้ามใช้บัตร", async () => {
    const memberCode = generateMemberCode();
    const [expiredMember] = await t.db
      .insert(members)
      .values({
        memberCode,
        name: "สมาชิกบัตรหมดอายุ",
        phone: "0800000099",
        points: 77,
        cardActivatedAt: new Date("2025-01-01T00:00:00.000Z"),
        cardExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .returning();

    const firstRead = await t
      .caller()
      .membership.listMembers({ search: memberCode });
    expect(firstRead[0]).toMatchObject({ id: expiredMember!.id, points: 0 });

    const expiryRows = await t.db
      .select()
      .from(pointTransactions)
      .where(eq(pointTransactions.memberId, expiredMember!.id));
    expect(expiryRows).toEqual([
      expect.objectContaining({
        branchId: 1,
        type: "expire",
        points: -77,
        note: "แต้มหมดอายุอัตโนมัติ เมื่อบัตรครบอายุ 1 ปี",
      }),
    ]);

    await t.caller().membership.listMembers({ search: memberCode });
    const afterSecondRead = await t.db
      .select()
      .from(pointTransactions)
      .where(eq(pointTransactions.memberId, expiredMember!.id));
    expect(afterSecondRead).toHaveLength(1);

    await expect(
      t.caller("admin").membership.adjustPoints({
        memberId: expiredMember!.id,
        points: 10,
        note: "ไม่ควรเพิ่มได้",
      })
    ).rejects.toThrow("บัตรสมาชิกหมดอายุแล้ว");

    const reward = await rewardByName("น้ำดื่ม 1 ขวด");
    await expect(
      t.caller().membership.redeemReward({
        memberId: expiredMember!.id,
        rewardId: reward.id,
      })
    ).rejects.toThrow("บัตรสมาชิกหมดอายุแล้ว");
  });
});

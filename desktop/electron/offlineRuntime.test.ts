import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DesktopSaleRequest } from "../../web/contracts/offline";
import { buildOfflineReceipt, DesktopOfflineRuntime } from "./offlineRuntime";

describe("buildOfflineReceipt", () => {
  it("สร้างใบเสร็จออฟไลน์จาก snapshot สินค้าและคำนวณยอดตรงกับ API", () => {
    const request: DesktopSaleRequest = {
      input: {
        staffName: "พนักงานทดสอบ",
        memberId: 7,
        items: [
          { productId: 1, qty: 2 },
          { productId: 2, qty: 1.5 },
        ],
        discount: 5,
        paymentMethod: "cash",
        received: 200,
        pointsToRedeem: 10,
      },
      lines: [
        {
          productId: 1,
          name: "น้ำดื่ม",
          unit: "ขวด",
          unitPrice: 10,
          category: "other",
          qty: 2,
        },
        {
          productId: 2,
          name: "น้ำมัน",
          unit: "ลิตร",
          unitPrice: 40,
          category: "fuel",
          qty: 1.5,
        },
      ],
      context: {
        vatRate: 7,
        pointEarnPerBaht: 25,
        pointRedeemValue: 1,
        memberName: "สมาชิกทดสอบ",
        customerName: null,
      },
    };

    const receipt = buildOfflineReceipt(
      request,
      "OFF-ABC123-20260721162539-0001",
      new Date("2026-07-21T09:25:39.000Z"),
      -1
    );

    expect(receipt.sale).toMatchObject({
      id: -1,
      subtotal: 80,
      discount: 15,
      total: 65,
      vatAmount: 4.25,
      received: 200,
      changeAmt: 135,
      pointsEarned: 2,
      pointsRedeemed: 10,
    });
    expect(receipt.items).toEqual([
      { name: "น้ำดื่ม", qty: 2, unit: "ขวด", unitPrice: 10, amount: 20 },
      { name: "น้ำมัน", qty: 1.5, unit: "ลิตร", unitPrice: 40, amount: 60 },
    ]);
  });

  it("ไม่สร้างใบเสร็จหาก snapshot สินค้าไม่ครบ", () => {
    const request: DesktopSaleRequest = {
      input: {
        staffName: "พนักงานทดสอบ",
        items: [{ productId: 99, qty: 1 }],
        discount: 0,
        paymentMethod: "qr",
        received: 0,
        pointsToRedeem: 0,
      },
      lines: [],
      context: {
        vatRate: 7,
        pointEarnPerBaht: 25,
        pointRedeemValue: 1,
        memberName: null,
        customerName: null,
      },
    };

    expect(() =>
      buildOfflineReceipt(
        request,
        "OFF-ABC123-20260721162539-0002",
        new Date(),
        -2
      )
    ).toThrow("ไม่พบข้อมูลสินค้า #99");
  });

  it("เก็บคิวบิลลงดิสก์ทันทีเมื่อออฟไลน์และอ่านกลับได้หลังเปิดโปรแกรมใหม่", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-offline-test-"));
    try {
      const request: DesktopSaleRequest = {
        input: {
          staffName: "พนักงานทดสอบ",
          items: [{ productId: 1, qty: 2 }],
          discount: 0,
          paymentMethod: "cash",
          received: 100,
          pointsToRedeem: 0,
        },
        lines: [
          {
            productId: 1,
            name: "น้ำดื่ม",
            unit: "ขวด",
            unitPrice: 10,
            category: "other",
            qty: 2,
          },
        ],
        context: {
          vatRate: 7,
          pointEarnPerBaht: 25,
          pointRedeemValue: 1,
          memberName: null,
          customerName: null,
        },
      };
      const options = {
        dataDir,
        staticDir: dataDir,
        remoteOrigin: "http://127.0.0.1:1",
      };

      const firstRuntime = new DesktopOfflineRuntime(options);
      const result = await firstRuntime.createSale(request);
      expect(result.mode).toBe("queued");
      expect(result.pendingCount).toBe(1);
      expect(result.sale.id).toBeLessThan(0);

      const reopenedRuntime = new DesktopOfflineRuntime(options);
      expect(reopenedRuntime.getStatus().pendingCount).toBe(1);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

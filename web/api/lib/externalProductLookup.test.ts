import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearExternalProductLookupCacheForTests,
  lookupExternalProduct,
} from "./externalProductLookup";

beforeEach(() => clearExternalProductLookupCacheForTests());

describe("lookupExternalProduct", () => {
  it("ค้นหาข้ามฐาน Open Facts และคืนเฉพาะข้อมูลที่ใช้สร้างสินค้า", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          product: {
            code: "08851234567890",
            product_name_th: "น้ำดื่มทดสอบ",
            product_name: "Test Water",
            brands: "แบรนด์ทดสอบ",
            quantity: "600 ml",
            product_type: "food",
            image_front_small_url:
              "https://images.openfoodfacts.org/images/products/test.jpg",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await lookupExternalProduct("8851234567890", fetchMock);

    expect(result).toEqual({
      provider: "open_facts",
      providerLabel: "Open Food Facts",
      barcode: "8851234567890",
      name: "น้ำดื่มทดสอบ",
      brand: "แบรนด์ทดสอบ",
      quantity: "600 ml",
      productType: "food",
      imageUrl: "https://images.openfoodfacts.org/images/products/test.jpg",
      sourceUrl: "https://world.openfoodfacts.org/product/08851234567890",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("product_type=all");
    expect(String(url)).toContain("cc=th");
    expect(new Headers(init?.headers).get("User-Agent")).toContain("PumpPOS/");
  });

  it("คืน null เมื่อไม่พบ และ cache ผลเพื่อไม่ยิง API ซ้ำ", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      lookupExternalProduct("8851234567890", fetchMock)
    ).resolves.toBeNull();
    await expect(
      lookupExternalProduct("8851234567890", fetchMock)
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("ตรวจรูปแบบบาร์โค้ดและแปลง rate limit เป็นข้อความที่เข้าใจได้", async () => {
    await expect(lookupExternalProduct("ABC", vi.fn())).rejects.toThrow(
      "ตัวเลข 8–14 หลัก"
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }));
    await expect(
      lookupExternalProduct("8851234567890", fetchMock)
    ).rejects.toThrow("ใช้งานถี่เกินไป");
  });
});

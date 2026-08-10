import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import { products } from "@db/schema";
import { clearExternalProductLookupCacheForTests } from "../lib/externalProductLookup";
import { setupTestDb, type TestDb } from "../test/testDb";

let test: TestDb;

beforeAll(async () => {
  test = await setupTestDb();
});

beforeEach(() => {
  clearExternalProductLookupCacheForTests();
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllGlobals();
  test.cleanup();
});

describe("นำเข้าสินค้าจากฐานข้อมูลภายนอก", () => {
  it("ค้นหา Open Food Facts แล้วเพิ่มเป็นสินค้าของสาขาปัจจุบัน", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "success",
            product: {
              code: "8851234567890",
              product_name_th: "น้ำดื่มออนไลน์ 600 มล.",
              brands: "แบรนด์ออนไลน์",
              quantity: "600 ml",
              product_type: "food",
              image_front_small_url:
                "https://images.openfoodfacts.org/images/products/test.jpg",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const cashier = test.caller("cashier");
    const lookup = await cashier.catalog.searchExternalProduct({
      barcode: "8851234567890",
    });
    expect(lookup).toMatchObject({
      provider: "open_facts",
      barcode: "8851234567890",
      name: "น้ำดื่มออนไลน์ 600 มล.",
      brand: "แบรนด์ออนไลน์",
      quantity: "600 ml",
    });

    const imported = await test.caller("admin").catalog.importExternalProduct({
      barcode: lookup!.barcode,
      name: lookup!.name,
      category: "other",
      unit: "ขวด",
      price: 12,
      cost: 7.25,
      stockQty: 4,
      lowStockAt: 1,
      imageUrl: lookup!.imageUrl,
    });
    expect(imported).toMatchObject({
      branchId: 1,
      code: "8851234567890",
      name: "น้ำดื่มออนไลน์ 600 มล.",
      price: 12,
      stockQty: 4,
      cost: 7.25,
      imageUrl: "https://images.openfoodfacts.org/images/products/test.jpg",
    });

    const stored = await test.db.query.products.findFirst({
      where: and(eq(products.branchId, 1), eq(products.code, "8851234567890")),
    });
    expect(stored).toMatchObject({
      cost: 7.25,
      stockQty: 4,
      lowStockAt: 1,
      imageUrl: "https://images.openfoodfacts.org/images/products/test.jpg",
    });

    await expect(
      cashier.catalog.importExternalProduct({
        barcode: lookup!.barcode,
        name: lookup!.name,
        category: "other",
        unit: "ขวด",
        price: 12,
        cost: 0,
        stockQty: 1,
        lowStockAt: 0,
      })
    ).rejects.toThrow("สินค้านี้มีอยู่ในสาขาแล้ว");
  });

  it("ปฏิเสธรหัสที่ไม่ใช่ GTIN/EAN/UPC ก่อนเรียกอินเทอร์เน็ต", async () => {
    await expect(
      test.caller("cashier").catalog.searchExternalProduct({
        barcode: "NOT-A-BARCODE",
      })
    ).rejects.toThrow("ตัวเลข 8–14 หลัก");
  });
});

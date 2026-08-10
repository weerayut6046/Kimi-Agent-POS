const OPEN_FACTS_ORIGIN = "https://world.openfoodfacts.org";
const OPEN_FACTS_API_VERSION = "v3.6";
const OPEN_FACTS_USER_AGENT =
  "PumpPOS/2.1.11 (https://github.com/weerayut6046/Kimi-Agent-POS)";
const LOOKUP_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 15 * 60_000;
const MAX_CACHE_SIZE = 500;

type FetchLike = typeof fetch;

type OpenFactsProduct = {
  code?: unknown;
  product_name?: unknown;
  product_name_th?: unknown;
  product_name_en?: unknown;
  generic_name?: unknown;
  brands?: unknown;
  quantity?: unknown;
  product_type?: unknown;
  image_front_small_url?: unknown;
  image_front_url?: unknown;
};

type OpenFactsResponse = {
  status?: unknown;
  product?: OpenFactsProduct;
};

export type ExternalProductLookup = {
  provider: "open_facts";
  providerLabel:
    | "Open Food Facts"
    | "Open Beauty Facts"
    | "Open Pet Food Facts"
    | "Open Products Facts";
  barcode: string;
  name: string;
  brand: string;
  quantity: string;
  productType: "food" | "beauty" | "petfood" | "product" | "unknown";
  imageUrl: string | null;
  sourceUrl: string;
};

type CacheEntry = {
  expiresAt: number;
  value: ExternalProductLookup | null;
};

const cache = new Map<string, CacheEntry>();

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function safeExternalProductImageUrl(
  ...values: unknown[]
): string | null {
  const allowedHosts = new Set([
    "images.openfoodfacts.org",
    "images.openbeautyfacts.org",
    "images.openpetfoodfacts.org",
    "images.openproductsfacts.org",
  ]);
  for (const value of values) {
    const raw = textValue(value);
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" && allowedHosts.has(url.hostname)) {
        return url.toString();
      }
    } catch {
      // ข้อมูลรูปจากผู้ให้บริการไม่สมบูรณ์ ให้ข้ามรูปโดยยังใช้ข้อมูลสินค้าได้
    }
  }
  return null;
}

function projectForProductType(
  productType: ExternalProductLookup["productType"]
): { label: ExternalProductLookup["providerLabel"]; origin: string } {
  if (productType === "beauty") {
    return {
      label: "Open Beauty Facts",
      origin: "https://world.openbeautyfacts.org",
    };
  }
  if (productType === "petfood") {
    return {
      label: "Open Pet Food Facts",
      origin: "https://world.openpetfoodfacts.org",
    };
  }
  if (productType === "product") {
    return {
      label: "Open Products Facts",
      origin: "https://world.openproductsfacts.org",
    };
  }
  return { label: "Open Food Facts", origin: OPEN_FACTS_ORIGIN };
}

function normalizedProductType(
  value: unknown
): ExternalProductLookup["productType"] {
  return ["food", "beauty", "petfood", "product"].includes(String(value))
    ? (String(value) as ExternalProductLookup["productType"])
    : "unknown";
}

function remember(barcode: string, value: ExternalProductLookup | null): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(barcode, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

export function clearExternalProductLookupCacheForTests(): void {
  cache.clear();
}

export async function lookupExternalProduct(
  barcode: string,
  fetchImpl: FetchLike = fetch
): Promise<ExternalProductLookup | null> {
  const normalizedBarcode = barcode.trim();
  if (!/^\d{8,14}$/.test(normalizedBarcode)) {
    throw new Error("บาร์โค้ดสำหรับค้นหาออนไลน์ต้องเป็นตัวเลข 8–14 หลัก");
  }

  const cached = cache.get(normalizedBarcode);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) cache.delete(normalizedBarcode);

  const url = new URL(
    `/api/${OPEN_FACTS_API_VERSION}/product/${encodeURIComponent(normalizedBarcode)}.json`,
    OPEN_FACTS_ORIGIN
  );
  url.searchParams.set("product_type", "all");
  url.searchParams.set("cc", "th");
  url.searchParams.set("lc", "th");
  url.searchParams.set(
    "fields",
    [
      "code",
      "product_name",
      "product_name_th",
      "product_name_en",
      "generic_name",
      "brands",
      "quantity",
      "product_type",
      "image_front_small_url",
      "image_front_url",
    ].join(",")
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": OPEN_FACTS_USER_AGENT,
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (response.status === 404) {
      remember(normalizedBarcode, null);
      return null;
    }
    if (response.status === 429) {
      throw new Error(
        "ระบบค้นหาสินค้าภายนอกถูกใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่"
      );
    }
    if (!response.ok) {
      throw new Error(
        `ระบบค้นหาสินค้าภายนอกไม่พร้อมใช้งาน (HTTP ${response.status})`
      );
    }

    const payload = (await response.json()) as OpenFactsResponse;
    const product = payload.product;
    if (!product || payload.status === "failure") {
      remember(normalizedBarcode, null);
      return null;
    }

    const returnedBarcode =
      textValue(product.code).replace(/\D/g, "") || normalizedBarcode;
    const brand = textValue(product.brands);
    const name =
      textValue(product.product_name_th) ||
      textValue(product.product_name) ||
      textValue(product.product_name_en) ||
      textValue(product.generic_name) ||
      brand ||
      `สินค้า ${returnedBarcode}`;
    const productType = normalizedProductType(product.product_type);
    const project = projectForProductType(productType);
    const result: ExternalProductLookup = {
      provider: "open_facts",
      providerLabel: project.label,
      // เก็บรหัสตามที่เครื่องสแกนส่งมา เพื่อให้ยิงครั้งถัดไปพบในฐานร้านทันที
      barcode: normalizedBarcode,
      name,
      brand,
      quantity: textValue(product.quantity),
      productType,
      imageUrl: safeExternalProductImageUrl(
        product.image_front_small_url,
        product.image_front_url
      ),
      sourceUrl: `${project.origin}/product/${encodeURIComponent(returnedBarcode)}`,
    };
    remember(normalizedBarcode, result);
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("ค้นหาสินค้าภายนอกหมดเวลา กรุณาลองใหม่");
    }
    if (error instanceof Error) throw error;
    throw new Error("เชื่อมต่อระบบค้นหาสินค้าภายนอกไม่สำเร็จ");
  } finally {
    clearTimeout(timeout);
  }
}

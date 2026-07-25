const VAT_SERVICE_URL = "https://rdws.rd.go.th/jsonRD/vatserviceRD3.asmx";
const VAT_SERVICE_NAMESPACE = "https://rdws.rd.go.th/JserviceRD3/vatserviceRD3";
const LOOKUP_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 500;

type FetchLike = typeof fetch;

type VatServicePayload = Record<string, unknown>;

type CachedLookup = {
  expiresAt: number;
  value: RevenueDepartmentTaxpayer;
};

const lookupCache = new Map<string, CachedLookup>();

export type RevenueDepartmentTaxpayer = {
  taxId: string;
  name: string;
  branchType: "hq" | "branch";
  branchNo: string;
  address: string;
  source: "rd-vat";
  verifiedAt: string;
};

export class TaxpayerNotFoundError extends Error {
  constructor() {
    super("Taxpayer was not found in the Revenue Department VAT registry");
    this.name = "TaxpayerNotFoundError";
  }
}

export class RevenueDepartmentUnavailableError extends Error {
  constructor(message = "Revenue Department VAT service is unavailable") {
    super(message);
    this.name = "RevenueDepartmentUnavailableError";
  }
}

function xmlEntityDecode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractServiceResult(xml: string): VatServicePayload {
  const match = xml.match(
    /<(?:[\w-]+:)?ServiceResult(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?ServiceResult>/i
  );
  if (!match) {
    if (/<(?:[\w-]+:)?ServiceResult(?:\s[^>]*)?\/>/i.test(xml)) {
      throw new TaxpayerNotFoundError();
    }
    throw new RevenueDepartmentUnavailableError(
      "Revenue Department returned an invalid response"
    );
  }

  try {
    const parsed: unknown = JSON.parse(xmlEntityDecode(match[1]).trim());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Unexpected VAT service response");
    }
    return parsed as VatServicePayload;
  } catch (error) {
    if (error instanceof TaxpayerNotFoundError) throw error;
    throw new RevenueDepartmentUnavailableError(
      "Revenue Department returned an invalid response"
    );
  }
}

function valuesOf(payload: VatServicePayload, key: string): unknown[] {
  const value = payload[key] ?? payload[`v${key}`];
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function textAt(
  payload: VatServicePayload,
  key: string,
  index: number
): string {
  const value = valuesOf(payload, key)[index];
  if (value == null) return "";
  const text = String(value).trim();
  return text === "-" ? "" : text;
}

function numberAt(
  payload: VatServicePayload,
  key: string,
  index: number
): number {
  const value = valuesOf(payload, key)[index];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function titledName(title: string, name: string, surname: string): string {
  const parts: string[] = [];
  if (title && !name.startsWith(title)) parts.push(title);
  if (name) parts.push(name);
  if (surname && surname !== name) parts.push(surname);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function withPrefix(prefix: string, value: string): string {
  if (!value) return "";
  return value.startsWith(prefix.trim()) ? value : `${prefix}${value}`;
}

function formatAddress(payload: VatServicePayload, index: number): string {
  const province = textAt(payload, "Province", index);
  const isBangkok = province === "กรุงเทพมหานคร" || province === "กรุงเทพฯ";
  const parts = [
    withPrefix("อาคาร ", textAt(payload, "BuildingName", index)),
    withPrefix("ห้อง ", textAt(payload, "RoomNumber", index)),
    withPrefix("ชั้น ", textAt(payload, "FloorNumber", index)),
    withPrefix("หมู่บ้าน ", textAt(payload, "VillageName", index)),
    withPrefix("เลขที่ ", textAt(payload, "HouseNumber", index)),
    withPrefix("หมู่ ", textAt(payload, "MooNumber", index)),
    withPrefix("ซอย", textAt(payload, "SoiName", index)),
    withPrefix("แยก", textAt(payload, "Yaek", index)),
    withPrefix("ถนน", textAt(payload, "StreetName", index)),
    withPrefix(isBangkok ? "แขวง" : "ตำบล", textAt(payload, "Thambol", index)),
    withPrefix(isBangkok ? "เขต" : "อำเภอ", textAt(payload, "Amphur", index)),
    isBangkok ? province : withPrefix("จังหวัด", province),
    textAt(payload, "PostCode", index),
  ];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function recordAt(
  payload: VatServicePayload,
  index: number
): RevenueDepartmentTaxpayer | null {
  const taxId = textAt(payload, "NID", index);
  const branchNumber = numberAt(payload, "BranchNumber", index);
  const name = titledName(
    textAt(payload, "BranchTitleName", index) ||
      textAt(payload, "TitleName", index),
    textAt(payload, "BranchName", index) || textAt(payload, "Name", index),
    textAt(payload, "Surname", index)
  );
  if (!taxId || !name) return null;

  return {
    taxId,
    name,
    branchType: branchNumber === 0 ? "hq" : "branch",
    branchNo: branchNumber === 0 ? "" : String(branchNumber).padStart(5, "0"),
    address: formatAddress(payload, index),
    source: "rd-vat",
    verifiedAt: new Date().toISOString(),
  };
}

function parseVatServiceResponse(
  xml: string,
  requestedBranch: number
): RevenueDepartmentTaxpayer {
  const payload = extractServiceResult(xml);
  const serviceErrors = valuesOf(payload, "msgerr")
    .map(value => String(value).trim())
    .filter(value => value && value !== "-");
  const recordCount = Math.max(
    valuesOf(payload, "NID").length,
    valuesOf(payload, "BranchNumber").length
  );
  const records = Array.from({ length: recordCount }, (_, index) =>
    recordAt(payload, index)
  ).filter((value): value is RevenueDepartmentTaxpayer => value != null);

  if (records.length === 0) {
    if (serviceErrors.length > 0) {
      throw new RevenueDepartmentUnavailableError();
    }
    throw new TaxpayerNotFoundError();
  }

  if (requestedBranch > 0) {
    const branchNo = String(requestedBranch).padStart(5, "0");
    const exact = records.find(record => record.branchNo === branchNo);
    if (!exact) throw new TaxpayerNotFoundError();
    return exact;
  }

  return records.find(record => record.branchType === "hq") ?? records[0];
}

function soapRequest(taxId: string, branchNumber: number): string {
  return `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:vat="${VAT_SERVICE_NAMESPACE}"><soap:Header/><soap:Body><vat:Service><vat:username>anonymous</vat:username><vat:password>anonymous</vat:password><vat:TIN>${taxId}</vat:TIN><vat:Name></vat:Name><vat:ProvinceCode>0</vat:ProvinceCode><vat:BranchNumber>${branchNumber}</vat:BranchNumber><vat:AmphurCode>0</vat:AmphurCode></vat:Service></soap:Body></soap:Envelope>`;
}

function pruneCache(now: number): void {
  for (const [key, cached] of lookupCache) {
    if (cached.expiresAt <= now) lookupCache.delete(key);
  }
  while (lookupCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = lookupCache.keys().next().value as string | undefined;
    if (!oldest) break;
    lookupCache.delete(oldest);
  }
}

export async function lookupRevenueDepartmentTaxpayer(
  input: { taxId: string; branchNumber?: number },
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}
): Promise<RevenueDepartmentTaxpayer> {
  const taxId = input.taxId.trim();
  const branchNumber = Math.max(0, Math.trunc(input.branchNumber ?? 0));
  const cacheKey = `${taxId}:${branchNumber}`;
  const now = Date.now();
  const useCache = options.fetchImpl == null;

  if (useCache) {
    const cached = lookupCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;
    pruneCache(now);
  }

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(VAT_SERVICE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/soap+xml; charset=utf-8",
      },
      body: soapRequest(taxId, branchNumber),
      signal: AbortSignal.timeout(options.timeoutMs ?? LOOKUP_TIMEOUT_MS),
    });
  } catch {
    throw new RevenueDepartmentUnavailableError();
  }

  if (!response.ok) throw new RevenueDepartmentUnavailableError();

  let xml: string;
  try {
    xml = await response.text();
  } catch {
    throw new RevenueDepartmentUnavailableError();
  }
  if (xml.length > 1_000_000) {
    throw new RevenueDepartmentUnavailableError(
      "Revenue Department response was too large"
    );
  }

  const value = parseVatServiceResponse(xml, branchNumber);
  if (useCache) {
    lookupCache.set(cacheKey, {
      value,
      expiresAt: now + CACHE_TTL_MS,
    });
  }
  return value;
}

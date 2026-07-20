/**
 * สร้าง HTML เอกสารสำหรับพิมพ์เฉพาะ element ที่ระบุ — คัดลอก stylesheet ของหน้าปัจจุบันไปด้วย
 * ให้ style เหมือนเดิม; ใส่ <base> ให้ link stylesheet แบบ relative โหลดได้แม้เปิดในหน้าต่าง data: URL
 * (ใช้ร่วมกันทั้งพิมพ์ผ่าน iframe ของเบราว์เซอร์ และพิมพ์เงียบผ่าน Electron)
 */
function buildPrintDocument(
  el: HTMLElement,
  pageCss: string,
  extraCss = ""
): string {
  const head = Array.from(
    document.querySelectorAll('link[rel="stylesheet"], style')
  )
    .map(n => n.outerHTML)
    .join("");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/">${head}` +
    `<style>@page{${pageCss}}html,body{margin:0;padding:0;background:#fff}` +
    `body>div{border:none!important;box-shadow:none!important}${extraCss}</style>` +
    `</head><body>${el.outerHTML}</body></html>`
  );
}

/**
 * พิมพ์เฉพาะ element ที่ระบุ ผ่าน iframe แยก — เนื้อหาอื่นในหน้า (dialog, เมนู, ตาราง)
 * จะไม่ติดไปบนกระดาษ
 */
export function printElement(
  el: HTMLElement,
  pageCss = "size: A4 portrait; margin: 12mm",
  extraCss = ""
) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow!;
  const doc = win.document;

  doc.open();
  doc.write(buildPrintDocument(el, pageCss, extraCss));
  doc.close();

  let settledDone = false;
  const cleanup = () => {
    if (settledDone) return;
    settledDone = true;
    iframe.remove();
  };
  win.addEventListener("afterprint", cleanup);
  setTimeout(cleanup, 60_000); // กัน iframe ค้างถ้า afterprint ไม่ยิง

  let printed = false;
  const run = () => {
    if (printed) return;
    printed = true;
    win.focus();
    win.print();
  };

  // รอ stylesheet โหลดครบก่อนสั่งพิมพ์ ไม่เช่นนั้นเอกสารจะไม่มี style
  const links = Array.from(
    doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
  );
  if (links.length === 0) {
    setTimeout(run, 50);
    return;
  }
  let settled = 0;
  const onSettle = () => {
    if (++settled >= links.length) run();
  };
  links.forEach(l => {
    l.addEventListener("load", onSettle);
    l.addEventListener("error", onSettle);
  });
  setTimeout(run, 3_000); // fallback
}

/** ขนาดกระดาษใบเสร็จที่ผู้ใช้เลือกเองในหน้า Settings (key receipt_paper_size) */
export type ReceiptPaper = "58" | "80" | "a5" | "a4";

/** แปลงค่าจาก setting เป็น ReceiptPaper (ค่าแปลก/ว่าง → 80 มม.) */
export function parseReceiptPaper(v: string | undefined | null): ReceiptPaper {
  return v === "58" || v === "a5" || v === "a4" ? v : "80";
}

/**
 * CSS ใบเสร็จตามขนาดกระดาษ (ใช้ร่วมกันทั้งพิมพ์ผ่าน dialog และพิมพ์เงียบ)
 * ม้วนความร้อน: กำหนด @page ตามขนาดม้วน บีบความกว้าง+ลดตัวอักษร (หน้าจอใช้ text-sm/xs ที่ใหญ่เกินกระดาษ)
 * กระดาษแผ่น: พิมพ์ขนาดตัวอักษรปกติ จำกัดแค่ความกว้างใบเสร็จ
 */
function receiptPrintCss(paper: ReceiptPaper): {
  pageCss: string;
  extraCss: string;
} {
  if (paper === "a4" || paper === "a5") {
    const widthMm = paper === "a4" ? 100 : 88;
    return {
      pageCss: `size: ${paper.toUpperCase()} portrait; margin: ${paper === "a4" ? 12 : 8}mm`,
      extraCss: `#receipt-print{width:${widthMm}mm!important}#receipt-print img{max-height:14mm;width:auto}`,
    };
  }
  const base = paper === "58" ? 9 : 10.5;
  const small = paper === "58" ? 8 : 9;
  const head = paper === "58" ? 10 : 12;
  // เครื่องความร้อนพิมพ์ได้แคบกว่ากระดาษจริง (เช่น GA-E200I พิมพ์ได้ ~72 มม. บนม้วน 80 มม.)
  // บีบเนื้อหาแคบลงและจัดกึ่งกลาง เผื่อขอบที่พิมพ์ไม่ได้ทั้งสองข้าง — กันตัวเลขชิดขวาถูกตัด
  return {
    pageCss: `size: ${paper}mm auto; margin: ${paper === "58" ? 2 : 4}mm`,
    extraCss:
      `#receipt-print{width:${paper === "58" ? 46 : 66}mm!important;margin:0 auto;font-size:${base}px!important;line-height:1.35}` +
      `#receipt-print .text-base{font-size:${head}px!important}` +
      `#receipt-print .text-sm{font-size:${base}px!important}` +
      `#receipt-print .text-xs{font-size:${small}px!important}` +
      `#receipt-print table{width:100%}` +
      // กระดาษ 58 มม. แคบ — บีบคอลัมน์จำนวน/จำนวนเงินให้ชื่อสินค้ามีพื้นที่เหลือ
      (paper === "58"
        ? `#receipt-print .w-14{width:36px!important}#receipt-print .w-28{width:64px!important}`
        : "") +
      `#receipt-print img{max-height:${paper === "58" ? 8 : 11}mm;width:auto}` +
      `#receipt-print th,#receipt-print td{padding:1px 2px}`,
  };
}

/** พิมพ์ใบเสร็จผ่านเบราว์เซอร์ (เด้ง dialog ให้เลือกเครื่องพิมพ์) — ขนาดกระดาษตามที่ตั้งใน Settings */
export function printReceiptElement(
  el: HTMLElement,
  paper: ReceiptPaper = "80"
) {
  const { pageCss, extraCss } = receiptPrintCss(paper);
  printElement(el, pageCss, extraCss);
}

/** ขนาดกระดาษใบกำกับภาษีเต็มรูปที่เลือกในหน้า Settings */
export type TaxInvoicePaper = "a4" | "a5";

/** แปลงค่าจาก setting เป็นขนาดใบกำกับภาษี (ค่าแปลก/ว่าง → A4 เพื่อคงพฤติกรรมเดิม) */
export function parseTaxInvoicePaper(
  v: string | undefined | null
): TaxInvoicePaper {
  return v === "a5" ? "a5" : "a4";
}

/** CSS หน้ากระดาษใบกำกับภาษี — ตัวเอกสาร A5 มีระยะขอบในตัว จึงไม่เพิ่ม margin ซ้ำ */
export function taxInvoicePrintCss(paper: TaxInvoicePaper): {
  pageCss: string;
  extraCss: string;
} {
  if (paper === "a5") {
    return {
      pageCss: "size: A5 portrait; margin: 0",
      extraCss:
        "#tax-invoice-print{width:148mm!important;max-width:148mm!important}",
    };
  }
  return {
    pageCss: "size: A4 portrait; margin: 12mm",
    extraCss:
      "#tax-invoice-print{width:100%!important;max-width:none!important}",
  };
}

/** พิมพ์ใบกำกับภาษีเต็มรูปตามขนาดกระดาษที่ตั้งไว้ */
export function printTaxInvoiceElement(
  el: HTMLElement,
  paper: TaxInvoicePaper = "a4"
) {
  const { pageCss, extraCss } = taxInvoicePrintCss(paper);
  printElement(el, pageCss, extraCss);
}

/** พิมพ์แบบฟอร์ม A4 แนวตั้ง (ใบขอเปิดเครดิต / รายการรถบรรทุก) — ตัวเอกสารมี padding ในตัว จึงใช้ margin แคบ */
export function printA4FormElement(el: HTMLElement) {
  printElement(
    el,
    "size: A4 portrait; margin: 8mm",
    `#${el.id}{width:100%!important;max-width:none!important}`
  );
}

/** ขนาดกระดาษหน่วยไมครอนสำหรับพิมพ์เงียบผ่าน Electron (ม้วนใช้สูง A4 ให้ครอบใบเสร็จยาว) */
const SILENT_PAGE_UM: Record<
  ReceiptPaper,
  { widthUm: number; heightUm: number }
> = {
  "80": { widthUm: 80_000, heightUm: 297_000 },
  "58": { widthUm: 58_000, heightUm: 297_000 },
  a5: { widthUm: 148_000, heightUm: 210_000 },
  a4: { widthUm: 210_000, heightUm: 297_000 },
};

/**
 * พิมพ์ใบเสร็จเงียบเข้าเครื่องพิมพ์ default ของ Windows ผ่าน Electron (desktop app เท่านั้น)
 * — Chromium render หน้าเอกสารเอง ภาษาไทยถูกเสมอ ไม่ต้องมีฟอนต์ไทยในเครื่องพิมพ์ และไม่เด้ง dialog
 */
export async function printReceiptSilent(
  el: HTMLElement,
  paper: ReceiptPaper = "80"
): Promise<void> {
  if (!window.posDesktop?.printSilent) {
    throw new Error("พิมพ์เงียบได้เฉพาะใน desktop app");
  }
  const { pageCss, extraCss } = receiptPrintCss(paper);
  await window.posDesktop.printSilent(
    buildPrintDocument(el, pageCss, extraCss),
    SILENT_PAGE_UM[paper]
  );
}

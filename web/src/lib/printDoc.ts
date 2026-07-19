/**
 * พิมพ์เฉพาะ element ที่ระบุ ผ่าน iframe แยก — เนื้อหาอื่นในหน้า (dialog, เมนู, ตาราง)
 * จะไม่ติดไปบนกระดาษ โดยคัดลอก stylesheet ของหน้าปัจจุบันเข้าไปใน iframe ให้ style เหมือนเดิม
 */
export function printElement(el: HTMLElement, pageCss = "size: A4 portrait; margin: 12mm", extraCss = "") {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow!;
  const doc = win.document;

  const head = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((n) => n.outerHTML)
    .join("");

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8">${head}` +
      `<style>@page{${pageCss}}html,body{margin:0;padding:0;background:#fff}` +
      `body>div{border:none!important;box-shadow:none!important}${extraCss}</style>` +
      `</head><body>${el.outerHTML}</body></html>`,
  );
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
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  if (links.length === 0) {
    setTimeout(run, 50);
    return;
  }
  let settled = 0;
  const onSettle = () => {
    if (++settled >= links.length) run();
  };
  links.forEach((l) => {
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
 * พิมพ์ใบเสร็จผ่านเบราว์เซอร์ให้พอดีกระดาษ — ขนาดกระดาษให้ผู้ใช้เลือกเองใน Settings
 * (80/58 มม. สำหรับเครื่องพิมพ์ความร้อน, A5/A4 สำหรับเครื่องพิมพ์แผ่น)
 * ม้วนความร้อน: กำหนด @page ตามขนาดม้วน บีบความกว้าง+ลดตัวอักษร (หน้าจอใช้ text-sm/xs ที่ใหญ่เกินกระดาษ)
 * กระดาษแผ่น: พิมพ์ขนาดตัวอักษรปกติ จำกัดแค่ความกว้างใบเสร็จ
 */
export function printReceiptElement(el: HTMLElement, paper: ReceiptPaper = "80") {
  if (paper === "a4" || paper === "a5") {
    const widthMm = paper === "a4" ? 100 : 88;
    const extraCss =
      `#receipt-print{width:${widthMm}mm!important}` +
      `#receipt-print img{max-height:14mm;width:auto}`;
    printElement(el, `size: ${paper.toUpperCase()} portrait; margin: ${paper === "a4" ? 12 : 8}mm`, extraCss);
    return;
  }
  const base = paper === "58" ? 9 : 10.5;
  const small = paper === "58" ? 8 : 9;
  const head = paper === "58" ? 10 : 12;
  const extraCss =
    `#receipt-print{width:${paper === "58" ? 50 : 72}mm!important;font-size:${base}px!important;line-height:1.35}` +
    `#receipt-print .text-base{font-size:${head}px!important}` +
    `#receipt-print .text-sm{font-size:${base}px!important}` +
    `#receipt-print .text-xs{font-size:${small}px!important}` +
    `#receipt-print table{width:100%}` +
    // กระดาษ 58 มม. แคบ — บีบคอลัมน์จำนวน/จำนวนเงินให้ชื่อสินค้ามีพื้นที่เหลือ
    (paper === "58" ? `#receipt-print .w-14{width:36px!important}#receipt-print .w-28{width:64px!important}` : "") +
    `#receipt-print img{max-height:${paper === "58" ? 8 : 11}mm;width:auto}` +
    `#receipt-print th,#receipt-print td{padding:1px 2px}`;
  printElement(el, `size: ${paper}mm auto; margin: ${paper === "58" ? 2 : 3}mm`, extraCss);
}

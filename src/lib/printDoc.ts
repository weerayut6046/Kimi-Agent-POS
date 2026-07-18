/**
 * พิมพ์เฉพาะ element ที่ระบุ ผ่าน iframe แยก — เนื้อหาอื่นในหน้า (dialog, เมนู, ตาราง)
 * จะไม่ติดไปบนกระดาษ โดยคัดลอก stylesheet ของหน้าปัจจุบันเข้าไปใน iframe ให้ style เหมือนเดิม
 */
export function printElement(el: HTMLElement, pageCss = "size: A4 portrait; margin: 12mm") {
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
      `body>div{border:none!important;box-shadow:none!important}</style>` +
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

/**
 * ดาวน์โหลดไฟล์ที่ server ส่งมาเป็น base64 (pattern เดียวกับ dbadmin.readBackup)
 * ใช้กับรายงาน Excel และไฟล์สำรอง — แปลง base64 → Blob → กดลิงก์จำลอง
 */
export function downloadBase64(fileName: string, contentBase64: string, mime = "application/octet-stream") {
  const bin = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bin], { type: mime }));
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

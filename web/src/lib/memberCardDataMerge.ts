import JsBarcode from "jsbarcode";
import JSZip from "jszip";
import QRCode from "qrcode";
import { formatMemberCode } from "@contracts/memberCode";

export type DataMergeMemberCard = {
  memberCode: string;
};

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildMemberCardDataMergeCsv(cards: DataMergeMemberCard[]) {
  const rows = cards.map((card, index) => {
    const code = card.memberCode;
    return [
      index + 1,
      code,
      formatMemberCode(code),
      `barcode/${code}.png`,
      `qr/${code}.png`,
      "ยังไม่เปิดใช้งาน",
    ]
      .map(csvCell)
      .join(",");
  });
  return [
    "record_no,card_number,card_number_display,@barcode_image,@qr_image,status",
    ...rows,
  ].join("\r\n");
}

function barcodePngBase64(memberCode: string) {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, memberCode, {
    format: "CODE128",
    width: 4,
    height: 180,
    margin: 32,
    displayValue: false,
    background: "#ffffff",
    lineColor: "#07152f",
  });
  return canvas.toDataURL("image/png").split(",")[1]!;
}

async function qrPngBase64(memberCode: string) {
  const dataUrl = await QRCode.toDataURL(memberCode, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 720,
    color: { dark: "#07152fff", light: "#ffffffff" },
  });
  return dataUrl.split(",")[1]!;
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function downloadMemberCardDataMergePackage(input: {
  batchCode: string;
  label?: string;
  cards: DataMergeMemberCard[];
}) {
  const zip = new JSZip();
  const csvBom = "\uFEFF";
  zip.file("data-merge.csv", csvBom + buildMemberCardDataMergeCsv(input.cards));
  zip.file(
    "README-TH.txt",
    [
      `ชุดบัตร: ${input.batchCode}`,
      `ชื่อชุด: ${input.label || "-"}`,
      `จำนวน: ${input.cards.length} ใบ`,
      "",
      "วิธีใช้ Data Merge ใน Adobe InDesign",
      "1. แตกไฟล์ ZIP โดยคงโฟลเดอร์ barcode และ qr ไว้ข้างไฟล์ data-merge.csv",
      "2. เลือก data-merge.csv จากแผง Data Merge",
      "3. วาง card_number_display ลงในกรอบข้อความ",
      "4. ลาก @barcode_image และ @qr_image ลงในกรอบรูป",
      "5. Merge ตามลำดับเดิม ห้ามเรียงหน้าและหลังคนละลำดับ",
      "",
      "บัตรรุ่นนี้ใช้ Barcode และ QR เท่านั้น ไม่มีแถบแม่เหล็ก",
      "ห้ามพิมพ์เลขบัตรเดียวกันซ้ำหลายใบ",
    ].join("\r\n")
  );

  const barcodeFolder = zip.folder("barcode")!;
  const qrFolder = zip.folder("qr")!;
  for (const card of input.cards) {
    const code = card.memberCode;
    barcodeFolder.file(`${code}.png`, barcodePngBase64(code), {
      base64: true,
    });
    qrFolder.file(`${code}.png`, await qrPngBase64(code), { base64: true });
  }

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  downloadBlob(`${input.batchCode}-data-merge.zip`, blob);
}

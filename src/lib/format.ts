export const fmtMoney = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtNum = (n: number) =>
  n.toLocaleString("th-TH", { maximumFractionDigits: 2 });

export const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });

export const fmtTime = (d: Date | string) =>
  new Date(d).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

export const fmtDateTime = (d: Date | string) => `${fmtDate(d)} ${fmtTime(d)}`;

export const paymentLabel: Record<string, string> = {
  cash: "เงินสด",
  qr: "QR พร้อมเพย์",
  card: "บัตร",
};

export const tierLabel: Record<string, string> = {
  silver: "ซิลเวอร์",
  gold: "โกลด์",
  platinum: "แพลทินัม",
};

export const categoryLabel: Record<string, string> = {
  fuel: "น้ำมัน",
  lubricant: "2T/น้ำมันเครื่อง",
  other: "สินค้าอื่นๆ",
};

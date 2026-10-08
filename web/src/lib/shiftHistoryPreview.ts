const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

type HistoryPreviewReading = {
  openMeter: number | string;
  closeMeter: string;
  openMoney: number | string;
  closeMoney: string;
  pricePerLiter: number;
};

export function getHistoryReadingPreview(
  readings: HistoryPreviewReading[] | null
) {
  if (!readings?.length) return null;
  let totalLiters = 0;
  let totalAmount = 0;
  let totalMoneyMeter = 0;
  let valid = true;
  for (const reading of readings) {
    if (
      reading.openMeter === "" ||
      reading.openMoney === "" ||
      reading.closeMeter === "" ||
      reading.closeMoney === ""
    ) {
      valid = false;
      continue;
    }
    const closeMeter = Number(reading.closeMeter);
    const closeMoney = Number(reading.closeMoney);
    const openMeter = Number(reading.openMeter);
    const openMoney = Number(reading.openMoney);
    if (
      !Number.isFinite(closeMeter) ||
      !Number.isFinite(closeMoney) ||
      !Number.isFinite(openMeter) ||
      !Number.isFinite(openMoney) ||
      closeMeter < openMeter ||
      closeMoney < openMoney
    ) {
      valid = false;
      continue;
    }
    const liters = round3(closeMeter - openMeter);
    totalLiters = round3(totalLiters + liters);
    totalAmount = round2(totalAmount + liters * reading.pricePerLiter);
    totalMoneyMeter = round2(totalMoneyMeter + closeMoney - openMoney);
  }
  return { totalLiters, totalAmount, totalMoneyMeter, valid };
}

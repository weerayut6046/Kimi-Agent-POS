export function bangkokMonthKey(value: Date | string | number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
  }).formatToParts(new Date(value));
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : "";
}

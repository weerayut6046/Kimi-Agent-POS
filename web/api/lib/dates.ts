/** Midnight-to-midnight in the station's business timezone. */
export function dayRange(date: string): { start: Date; end: Date } {
  const start = new Date(date + "T00:00:00+07:00");
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function bangkokDateKey(date: Date): string {
  return new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

const thaiTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function fmtDateTH(value: string | Date) {
  const [year, month, day] = bangkokDateKey(new Date(value)).split("-");
  return `${day}/${month}/${Number(year) + 543}`;
}

export function fmtDateTimeTH(value: string | Date) {
  return fmtDateTH(value) + " " + thaiTime.format(new Date(value));
}

/**
 * แปลง "YYYY-MM-DD" เป็นช่วงเวลาของวันนั้นใน local timezone
 * end = ต้นวันถัดไป (ใช้กับเงื่อนไข createdAt >= start AND createdAt < end)
 */
export function dayRange(date: string): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number);
  return {
    start: new Date(y!, m! - 1, d!),
    end: new Date(y!, m! - 1, d! + 1),
  };
}

import { useState } from "react";
import { trpc } from "@/providers/trpc";

/**
 * พิมพ์ใบเสร็จเข้าเครื่องพิมพ์ความร้อน (ESC/POS) — ใช้ร่วมกันหน้า POS และประวัติการขาย
 * printThermal เป็น fire-and-forget: ถ้าพิมพ์ไม่สำเร็จจะคืนข้อความ error ทาง printError แต่ไม่กระทบบิลที่บันทึกแล้ว
 */
export function useThermalPrint() {
  const [printError, setPrintError] = useState("");
  const mutation = trpc.printer.printReceipt.useMutation({
    onSuccess: () => setPrintError(""),
    onError: (e) => setPrintError(e.message),
  });
  const printThermal = (saleId: number) => {
    setPrintError("");
    mutation.mutate({ saleId });
  };
  return { printThermal, printing: mutation.isPending, printError };
}

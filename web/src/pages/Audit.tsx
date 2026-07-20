import { useEffect, useState } from "react";
import { ScrollText, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/providers/trpc";
import { fmtDateTime } from "@/lib/format";

/** label ภาษาไทยของ action — ถ้าไม่รู้จักแสดง action ดิบ */
const actionLabel: Record<string, string> = {
  void_sale: "ยกเลิกบิล",
  update_sale: "แก้ไขบิล",
  delete_sale: "ลบบิล",
  adjust_points: "ปรับแต้ม",
  update_price: "เปลี่ยนราคา",
  create_staff: "เพิ่มพนักงาน",
  update_staff: "แก้ไขพนักงาน",
  delete_staff: "ลบพนักงาน",
  restore_db: "กู้คืนฐานข้อมูล",
  restore_upload: "กู้คืนจากอัปโหลด",
  create_expense: "เพิ่มค่าใช้จ่าย",
  update_expense: "แก้ค่าใช้จ่าย",
  remove_expense: "ลบค่าใช้จ่าย",
  receive_debt_payment: "รับชำระหนี้",
  remove_debt_payment: "ลบการชำระหนี้",
};

export default function Audit() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");

  // debounce ช่องค้นหา
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = trpc.audit.list.useQuery({
    q: search || undefined,
    action: action === "all" ? undefined : action,
  });
  const rows = data?.rows ?? [];
  const actions = data?.actions ?? [];

  return (
    <div className="space-y-5">
      <h1 className="page-heading flex items-center gap-2">
        <ScrollText className="w-6 h-6 text-primary" /> บันทึกการใช้งาน
      </h1>

      <div className="flex gap-3 flex-wrap">
        <div className="relative min-w-0 flex-1 sm:min-w-56 sm:max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="ค้นหา ผู้ทำ / รายละเอียด"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="ทุกการกระทำ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกการกระทำ</SelectItem>
            {actions.map(a => (
              <SelectItem key={a} value={a}>
                {actionLabel[a] ?? a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead>ผู้ทำ</TableHead>
                <TableHead>การกระทำ</TableHead>
                <TableHead>รายละเอียด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {fmtDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.actorName || "-"}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {actionLabel[r.action] ?? r.action}
                  </TableCell>
                  <TableCell className="text-sm">{r.detail}</TableCell>
                </TableRow>
              ))}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground py-8"
                  >
                    {search || action !== "all"
                      ? "ไม่พบรายการที่ค้นหา"
                      : "ยังไม่มีบันทึกการใช้งาน"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

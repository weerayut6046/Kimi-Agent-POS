import { Link } from "react-router";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SetupSystemDraft } from "./setupSystemForm";

export default function SetupSystemStep({
  value,
  disabled,
  onChange,
}: {
  value: SetupSystemDraft;
  disabled: boolean;
  onChange: (value: SetupSystemDraft) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-heading text-lg font-semibold">
          ใบเสร็จ ภาษี และแต้มสมาชิก
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          ตรวจค่าเดิมและเลือกตามที่กิจการใช้งานจริงก่อนยืนยัน
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="setup-receipt-paper">กระดาษใบเสร็จ</Label>
          <Select
            value={value.receiptPaperSize}
            disabled={disabled}
            onValueChange={receiptPaperSize =>
              onChange({
                ...value,
                receiptPaperSize:
                  receiptPaperSize as SetupSystemDraft["receiptPaperSize"],
              })
            }
          >
            <SelectTrigger id="setup-receipt-paper">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="58">ม้วนความร้อน 58 มม.</SelectItem>
              <SelectItem value="80">ม้วนความร้อน 80 มม.</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="setup-tax-paper">กระดาษใบกำกับภาษีเต็มรูป</Label>
          <Select
            value={value.taxInvoicePaperSize}
            disabled={disabled}
            onValueChange={taxInvoicePaperSize =>
              onChange({
                ...value,
                taxInvoicePaperSize:
                  taxInvoicePaperSize as SetupSystemDraft["taxInvoicePaperSize"],
              })
            }
          >
            <SelectTrigger id="setup-tax-paper">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a4">A4</SelectItem>
              <SelectItem value="a5">A5</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="setup-vat">อัตรา VAT (%)</Label>
          <Input
            id="setup-vat"
            type="number"
            min="0"
            max="100"
            step="0.01"
            disabled={disabled}
            value={value.vatRate}
            onChange={event =>
              onChange({ ...value, vatRate: event.target.value })
            }
          />
        </div>
      </div>
      <label className="flex items-start gap-3 rounded-xl border p-4">
        <Checkbox
          className="mt-1"
          checked={value.silentPrint}
          disabled={disabled}
          onCheckedChange={checked =>
            onChange({ ...value, silentPrint: checked === true })
          }
        />
        <span>
          <span className="font-medium">พิมพ์ใบเสร็จทันทีหลังชำระเงิน</span>
          <span className="mt-1 block text-sm leading-6 text-muted-foreground">
            ใช้กับแอปบนเครื่องและเครื่องพิมพ์เริ่มต้นของเครื่องนั้น
            ทดสอบการพิมพ์ได้ในหน้าตั้งค่า
          </span>
        </span>
      </label>
      <div className="space-y-3 border-t pt-5">
        <h3 className="font-medium">แต้มสมาชิก</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          ใช้กับรายการที่เลือกสะสมหรือใช้แต้ม ตรวจอัตราตามนโยบายของกิจการ
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="setup-point-earn">ยอดซื้อกี่บาทจึงได้ 1 แต้ม</Label>
            <Input
              id="setup-point-earn"
              type="number"
              min="0.01"
              step="0.01"
              disabled={disabled}
              value={value.pointEarnPerBaht}
              onChange={event =>
                onChange({ ...value, pointEarnPerBaht: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-point-value">
              ใช้ 1 แต้มเป็นส่วนลดกี่บาท
            </Label>
            <Input
              id="setup-point-value"
              type="number"
              min="0.01"
              step="0.01"
              disabled={disabled}
              value={value.pointRedeemValue}
              onChange={event =>
                onChange({ ...value, pointRedeemValue: event.target.value })
              }
            />
          </div>
        </div>
      </div>
      <div className="space-y-3 rounded-xl bg-muted/50 p-4">
        <h3 className="font-medium">ตั้งค่าเพิ่มเติมตามที่ใช้</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          โลโก้และธีม โปรโมชัน สำรองข้อมูล ผู้ช่วย AI
          และการทดสอบเครื่องพิมพ์อยู่ในหน้าตั้งค่า ขั้นที่ยืนยันแล้วบันทึกไว้
          กลับมาทำต่อได้จากเมนูเริ่มต้นใช้งานกิจการ
        </p>
        <Link
          to="/settings"
          onClick={event => {
            if (disabled) event.preventDefault();
          }}
          className="inline-block text-sm text-primary underline underline-offset-4"
        >
          เปิดตั้งค่าเพิ่มเติม
        </Link>
      </div>
    </div>
  );
}

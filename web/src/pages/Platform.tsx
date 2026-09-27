import { useState, type FormEvent } from "react";
import { Building2, ExternalLink, Pencil, Plus, RefreshCw } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";

type BusinessForm = {
  id?: string;
  code: string;
  name: string;
  contactEmail: string;
  contactPhone: string;
  status: "active" | "paused";
  appUrl: string;
  supabaseProjectRef: string;
  notes: string;
};

const emptyForm = (): BusinessForm => ({
  code: "",
  name: "",
  contactEmail: "",
  contactPhone: "",
  status: "active",
  appUrl: "",
  supabaseProjectRef: "",
  notes: "",
});

export default function Platform() {
  const utils = trpc.useUtils();
  const overview = trpc.platform.overview.useQuery();
  const businesses = trpc.platform.listBusinesses.useQuery();
  const [form, setForm] = useState<BusinessForm | null>(null);
  const [formError, setFormError] = useState("");

  const afterSave = () => {
    setForm(null);
    setFormError("");
    void utils.platform.overview.invalidate();
    void utils.platform.listBusinesses.invalidate();
    toast.success("บันทึกทะเบียนกิจการแล้ว");
  };
  const create = trpc.platform.createBusiness.useMutation({
    onSuccess: afterSave,
    onError: error => setFormError(error.message),
  });
  const update = trpc.platform.updateBusiness.useMutation({
    onSuccess: afterSave,
    onError: error => setFormError(error.message),
  });
  const saving = create.isPending || update.isPending;

  const editField = <Key extends keyof BusinessForm>(
    key: Key,
    value: BusinessForm[Key]
  ) => {
    setForm(current => (current ? { ...current, [key]: value } : current));
    setFormError("");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form || saving) return;
    const { id, ...values } = form;
    const input = {
      ...values,
      code: values.code.trim().toUpperCase(),
      name: values.name.trim(),
      contactEmail: values.contactEmail.trim(),
      contactPhone: values.contactPhone.trim(),
      appUrl: values.appUrl.trim(),
      supabaseProjectRef: values.supabaseProjectRef.trim().toLowerCase(),
      notes: values.notes.trim(),
    };
    if (id) update.mutate({ id, ...input });
    else create.mutate(input);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-heading flex items-center gap-2">
            <Building2 className="size-6 text-primary" /> จัดการกิจการ
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ทะเบียนกิจการและทางเข้าใช้งานระบบขายของแต่ละกิจการ
          </p>
        </div>
        <Button
          onClick={() => {
            setFormError("");
            setForm(emptyForm());
          }}
        >
          <Plus className="mr-2 size-4" /> ลงทะเบียนกิจการ
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          ["กิจการทั้งหมด", overview.data?.total],
          ["สถานะใช้งาน", overview.data?.active],
          ["สถานะพักใช้งาน", overview.data?.paused],
        ].map(([label, value]) => (
          <Card key={label} className="py-4">
            <CardContent className="px-3 sm:px-5">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-2 font-heading text-2xl font-semibold tabular-nums">
                {value ?? "—"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        การลงทะเบียนบันทึกข้อมูลกิจการ
        ระบบขายและฐานข้อมูลของแต่ละกิจการต้องเตรียมไว้ก่อน
        สถานะใช้งานหรือพักใช้งานในหน้านี้เป็นสถานะของทะเบียน
      </div>

      {(overview.isError || businesses.isError) && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4 text-sm"
        >
          <span>
            {businesses.error?.message ??
              overview.error?.message ??
              "โหลดทะเบียนกิจการไม่สำเร็จ"}
          </span>
          <Button
            variant="outline"
            disabled={businesses.isFetching || overview.isFetching}
            onClick={() => {
              void overview.refetch();
              void businesses.refetch();
            }}
          >
            <RefreshCw className="mr-2 size-4" /> ลองใหม่
          </Button>
        </div>
      )}

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>กิจการ</TableHead>
                <TableHead>ผู้ติดต่อ</TableHead>
                <TableHead>สถานะทะเบียน</TableHead>
                <TableHead className="text-right">การจัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {businesses.isPending && (
                <TableRow>
                  <TableCell colSpan={4} className="py-12 text-center">
                    กำลังโหลดทะเบียนกิจการ...
                  </TableCell>
                </TableRow>
              )}
              {!businesses.isPending &&
                !businesses.isError &&
                businesses.data?.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-12 text-center text-muted-foreground"
                    >
                      ยังไม่มีกิจการ เริ่มจากลงทะเบียนระบบกิจการที่เตรียมไว้แล้ว
                    </TableCell>
                  </TableRow>
                )}
              {businesses.data?.map(business => (
                <TableRow key={business.id}>
                  <TableCell>
                    <div className="font-medium">{business.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {business.code}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{business.contactEmail || "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {business.contactPhone || "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        business.status === "active" ? "default" : "secondary"
                      }
                    >
                      {business.status === "active" ? "ใช้งาน" : "พักใช้งาน"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={business.appUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="mr-1 size-4" />{" "}
                          เปิดระบบกิจการ
                        </a>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setFormError("");
                          setForm({
                            id: business.id,
                            code: business.code,
                            name: business.name,
                            contactEmail: business.contactEmail,
                            contactPhone: business.contactPhone,
                            status: business.status,
                            appUrl: business.appUrl,
                            supabaseProjectRef: business.supabaseProjectRef,
                            notes: business.notes,
                          });
                        }}
                      >
                        <Pencil className="mr-1 size-4" /> แก้ไข
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(form)}
        onOpenChange={open => {
          if (!open && !saving) setForm(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "แก้ไขทะเบียนกิจการ" : "ลงทะเบียนกิจการ"}
            </DialogTitle>
            <DialogDescription>
              เชื่อมทะเบียนกับระบบกิจการที่เตรียมไว้แล้ว
              โดยแต่ละกิจการใช้โครงการฐานข้อมูลแยกกัน
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="platform-code">รหัสกิจการ</Label>
                  <Input
                    id="platform-code"
                    required
                    minLength={2}
                    maxLength={40}
                    pattern="[A-Za-z0-9_-]{2,40}"
                    value={form.code}
                    onChange={event => editField("code", event.target.value)}
                    placeholder="เช่น STATION_A"
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="platform-name">ชื่อกิจการ</Label>
                  <Input
                    id="platform-name"
                    required
                    maxLength={160}
                    value={form.name}
                    onChange={event => editField("name", event.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="platform-email">อีเมลผู้ติดต่อ</Label>
                  <Input
                    id="platform-email"
                    type="email"
                    maxLength={254}
                    value={form.contactEmail}
                    onChange={event =>
                      editField("contactEmail", event.target.value)
                    }
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="platform-phone">โทรศัพท์ผู้ติดต่อ</Label>
                  <Input
                    id="platform-phone"
                    type="tel"
                    maxLength={40}
                    value={form.contactPhone}
                    onChange={event =>
                      editField("contactPhone", event.target.value)
                    }
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="platform-app-url">ที่อยู่ระบบกิจการ</Label>
                <Input
                  id="platform-app-url"
                  type="url"
                  required
                  value={form.appUrl}
                  onChange={event => editField("appUrl", event.target.value)}
                  placeholder="https://station-a.example.com"
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  ใช้ที่อยู่ HTTPS ของระบบกิจการ ไม่มีชื่อผู้ใช้ รหัสผ่าน
                  หรือเส้นทางต่อท้าย
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="platform-project">
                  รหัสโครงการฐานข้อมูลของกิจการ (Supabase project ref)
                </Label>
                <Input
                  id="platform-project"
                  required
                  minLength={20}
                  maxLength={20}
                  pattern="[a-z0-9]{20}"
                  value={form.supabaseProjectRef}
                  onChange={event =>
                    editField(
                      "supabaseProjectRef",
                      event.target.value.toLowerCase()
                    )
                  }
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  ใช้ตรวจว่าแต่ละกิจการลงทะเบียนโครงการต่างกัน ไม่ต้องใส่ API
                  key หรือรหัสผ่าน
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="platform-status">สถานะทะเบียน</Label>
                <Select
                  value={form.status}
                  onValueChange={value =>
                    editField("status", value as BusinessForm["status"])
                  }
                  disabled={saving}
                >
                  <SelectTrigger id="platform-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">ใช้งาน</SelectItem>
                    <SelectItem value="paused">พักใช้งาน</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="platform-notes">หมายเหตุ</Label>
                <Textarea
                  id="platform-notes"
                  maxLength={2000}
                  rows={3}
                  value={form.notes}
                  onChange={event => editField("notes", event.target.value)}
                  disabled={saving}
                />
              </div>
              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => setForm(null)}
                >
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "กำลังบันทึก..." : "บันทึกทะเบียน"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

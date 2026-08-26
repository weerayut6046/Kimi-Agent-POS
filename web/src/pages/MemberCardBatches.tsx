import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import {
  BadgePlus,
  CheckCircle2,
  CreditCard,
  Download,
  FileArchive,
  Layers3,
  Loader2,
  QrCode,
  ScanBarcode,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/providers/trpc";
import { fmtDateTime } from "@/lib/format";
import { downloadMemberCardDataMergePackage } from "@/lib/memberCardDataMerge";
import { formatMemberCode } from "@contracts/memberCode";
import { toast } from "sonner";

function UnactivatedCardPreview({
  memberCode,
  logoUrl,
}: {
  memberCode: string;
  logoUrl?: string | null;
}) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    if (!memberCode) return;
    void QRCode.toDataURL(memberCode, {
      errorCorrectionLevel: "H",
      width: 360,
      margin: 2,
      color: { dark: "#07152fff", light: "#ffffffff" },
    }).then(setQrUrl);
    if (barcodeRef.current) {
      JsBarcode(barcodeRef.current, memberCode, {
        format: "CODE128",
        width: 1.7,
        height: 48,
        margin: 0,
        displayValue: false,
        lineColor: "#07152f",
      });
    }
  }, [memberCode]);

  const logo = (
    <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1 text-lg font-black text-blue-800">
      {logoUrl ? (
        <img src={logoUrl} alt="KY" className="size-full object-contain" />
      ) : (
        "KY"
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">ภาพบัตรด้านหน้า</p>
          <Badge variant="outline">Front</Badge>
        </div>
        <div className="relative aspect-[85.6/53.98] w-full max-w-[560px] overflow-hidden rounded-[24px] bg-gradient-to-br from-[#07152f] via-[#102a66] to-[#1557d6] p-5 text-white shadow-xl">
          <div className="absolute -right-12 -top-20 size-52 rounded-full bg-cyan-300/80" />
          <div className="absolute -bottom-24 -left-16 size-48 rounded-full bg-red-600" />
          <div className="relative z-10 flex h-full flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {logo}
                <div>
                  <p className="text-lg font-bold tracking-wide">
                    KY MEMBER CLUB
                  </p>
                  <p className="text-xs text-cyan-100">บัตรสมาชิกสะสมแต้ม</p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex min-h-0 flex-1 gap-4">
              <div className="flex min-w-0 flex-1 flex-col justify-end">
                <p className="text-[10px] tracking-widest text-indigo-100">
                  CARD NUMBER
                </p>
                <p className="mt-1 whitespace-nowrap text-[clamp(18px,4.2vw,29px)] font-black tracking-wide">
                  {formatMemberCode(memberCode)}
                </p>
                <p className="mt-1 text-[11px] text-cyan-100">
                  ใช้แต้มได้ทุกสาขา · เปิดใช้งานก่อนใช้สิทธิ์
                </p>
                <div className="mt-3 rounded-xl bg-white px-3 py-2">
                  <svg
                    ref={barcodeRef}
                    className="h-10 w-full"
                    aria-label={`Barcode ${memberCode}`}
                  />
                </div>
              </div>
              <div className="flex w-[25%] min-w-20 flex-col justify-end">
                <div className="rounded-xl bg-white p-1.5">
                  {qrUrl && (
                    <img
                      src={qrUrl}
                      alt={`QR ${memberCode}`}
                      className="w-full"
                    />
                  )}
                </div>
                <p className="mt-1 text-center text-[9px] font-bold">
                  SCAN TO ACTIVATE
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">ภาพบัตรด้านหลัง</p>
          <Badge variant="outline">Back · Barcode & QR</Badge>
        </div>
        <div className="relative aspect-[85.6/53.98] w-full max-w-[560px] overflow-hidden rounded-[24px] bg-gradient-to-br from-[#07152f] via-[#102a66] to-[#173d83] p-5 text-white shadow-xl">
          <div className="absolute -right-12 -top-20 size-52 rounded-full bg-cyan-300/80" />
          <div className="absolute -bottom-24 -left-16 size-48 rounded-full bg-red-600" />
          <div className="absolute left-[42%] top-[27%] h-[58%] w-px bg-white/20" />
          <div className="relative z-10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {logo}
              <p className="text-lg font-bold tracking-wide">KY MEMBER CLUB</p>
            </div>
          </div>

          <div className="absolute inset-x-5 bottom-5 top-[30%] z-10 grid grid-cols-[minmax(0,1fr)_28%] gap-5">
            <div className="flex min-w-0 flex-col justify-between">
              <div>
                <p className="text-sm font-bold">เงื่อนไขการใช้งาน</p>
                <div className="mt-2 space-y-1 text-[10px] leading-4 text-cyan-50">
                  <p>• ทุก 100 บาท รับ 1 แต้ม</p>
                  <p>• 1 แต้ม ใช้เป็นส่วนลดได้ 1 บาท</p>
                  <p>• บัตรและแต้มมีอายุ 1 ปีนับจากวันเปิดใช้</p>
                  <p>• ใช้บัตรและแต้มได้ทุกสาขา</p>
                </div>
              </div>
              <div className="rounded-xl bg-white/15 px-3 py-2">
                <p className="font-mono text-xs font-bold tracking-wider">
                  {formatMemberCode(memberCode)}
                </p>
                <p className="mt-0.5 text-[9px] text-cyan-100">
                  กรุณาเก็บบัตรไว้กับผู้ถือบัตร
                </p>
              </div>
            </div>
            <div className="flex flex-col justify-center">
              <div className="rounded-xl bg-white p-2">
                {qrUrl && (
                  <img
                    src={qrUrl}
                    alt={`QR หลังบัตร ${memberCode}`}
                    className="w-full"
                  />
                )}
              </div>
              <p className="mt-1 text-center text-[9px] font-bold">
                SCAN MEMBER QR
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function MemberCardBatches() {
  const utils = trpc.useUtils();
  const [quantity, setQuantity] = useState("100");
  const [label, setLabel] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [previewCardId, setPreviewCardId] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { data: logoUrl } = trpc.catalog.getShopLogo.useQuery();
  const batches = trpc.membership.listCardBatches.useQuery();
  const detail = trpc.membership.getCardBatch.useQuery(
    { id: selectedBatchId ?? 0 },
    { enabled: selectedBatchId !== null }
  );

  const createBatch = trpc.membership.createCardBatch.useMutation({
    onSuccess: async result => {
      setSelectedBatchId(result.batch.id);
      setLabel("");
      await Promise.all([
        utils.membership.listCardBatches.invalidate(),
        utils.membership.getCardBatch.invalidate({ id: result.batch.id }),
      ]);
      toast.success(
        `สร้าง ${result.batch.batchCode} สำเร็จ ${result.cards.length} ใบ`
      );
    },
    onError: error => toast.error(error.message),
  });

  const summary = useMemo(
    () =>
      (batches.data ?? []).reduce(
        (total, batch) => ({
          cards: total.cards + batch.total,
          unused: total.unused + batch.unused,
          activated: total.activated + batch.activated,
        }),
        { cards: 0, unused: 0, activated: 0 }
      ),
    [batches.data]
  );

  const parsedQuantity = Number(quantity);
  const quantityValid =
    Number.isInteger(parsedQuantity) &&
    parsedQuantity >= 1 &&
    parsedQuantity <= 500;
  const previewCard =
    detail.data?.cards.find(card => card.id === previewCardId) ??
    detail.data?.cards[0];

  const submit = () => {
    if (!quantityValid || createBatch.isPending) return;
    createBatch.mutate({ quantity: parsedQuantity, label: label || undefined });
  };

  const downloadPackage = async () => {
    if (!detail.data || downloading) return;
    setDownloading(true);
    try {
      await downloadMemberCardDataMergePackage({
        batchCode: detail.data.batch.batchCode,
        label: detail.data.batch.label,
        cards: detail.data.cards,
      });
      toast.success("ดาวน์โหลดชุด Data Merge สำเร็จ");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "สร้างไฟล์ Data Merge ไม่สำเร็จ"
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-heading flex items-center gap-2">
            <BadgePlus className="size-6 text-primary" /> สร้างชุดบัตรสมาชิก
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ลงทะเบียนเลขบัตร 16 หลัก พร้อม Barcode และ QR สำหรับผลิตบัตร PVC
            แบบไม่มีแถบแม่เหล็ก
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-cyan-200 bg-cyan-50 text-cyan-800"
        >
          <ShieldCheck className="mr-1 size-4" /> เลขบัตรไม่ซ้ำและใช้ได้ทุกสาขา
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Layers3 className="size-9 rounded-xl bg-violet-100 p-2 text-violet-700" />
            <div>
              <p className="text-xs text-muted-foreground">บัตรที่สร้างแล้ว</p>
              <p className="text-2xl font-bold">
                {summary.cards.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CreditCard className="size-9 rounded-xl bg-amber-100 p-2 text-amber-700" />
            <div>
              <p className="text-xs text-muted-foreground">ยังไม่เปิดใช้งาน</p>
              <p className="text-2xl font-bold">
                {summary.unused.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="size-9 rounded-xl bg-emerald-100 p-2 text-emerald-700" />
            <div>
              <p className="text-xs text-muted-foreground">เปิดใช้งานแล้ว</p>
              <p className="text-2xl font-bold">
                {summary.activated.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Layers3 className="size-5 text-primary" /> สร้างชุดใหม่
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="card-batch-quantity">จำนวนบัตร</Label>
              <Input
                id="card-batch-quantity"
                type="number"
                min={1}
                max={500}
                value={quantity}
                onChange={event => setQuantity(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {[50, 100, 250, 500].map(value => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={quantity === String(value) ? "default" : "outline"}
                    onClick={() => setQuantity(String(value))}
                  >
                    {value} ใบ
                  </Button>
                ))}
              </div>
              {!quantityValid && (
                <p className="text-xs text-destructive">
                  กำหนดได้ครั้งละ 1–500 ใบ
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-batch-label">ชื่อชุด/หมายเหตุ</Label>
              <Input
                id="card-batch-label"
                maxLength={80}
                placeholder="เช่น ผลิตครั้งที่ 2 · สิงหาคม 2569"
                value={label}
                onChange={event => setLabel(event.target.value)}
              />
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
              ระบบจะจองเลขทุกใบเป็นบัตรสต๊อก “ยังไม่เปิดใช้งาน”
              และเปลี่ยนสถานะเมื่อสมัครสมาชิกด้วยบัตรใบนั้น
            </div>
            <Button
              className="w-full"
              disabled={!quantityValid || createBatch.isPending}
              onClick={submit}
            >
              {createBatch.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <BadgePlus className="mr-2 size-4" />
              )}
              สร้างชุด {quantityValid ? parsedQuantity : 0} ใบ
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-lg">ประวัติชุดบัตร</CardTitle>
            <Badge variant="secondary">
              {batches.data?.length ?? 0} ชุดล่าสุด
            </Badge>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>รหัสชุด</TableHead>
                  <TableHead>สาขาที่สร้าง</TableHead>
                  <TableHead className="text-right">ยังไม่เปิดใช้</TableHead>
                  <TableHead className="text-right">เปิดใช้แล้ว</TableHead>
                  <TableHead>วันที่สร้าง</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(batches.data ?? []).map(batch => (
                  <TableRow
                    key={batch.id}
                    className={
                      selectedBatchId === batch.id
                        ? "bg-violet-50/70"
                        : undefined
                    }
                  >
                    <TableCell>
                      <p className="font-mono font-semibold">
                        {batch.batchCode}
                      </p>
                      <p className="max-w-52 truncate text-xs text-muted-foreground">
                        {batch.label || `${batch.quantity} ใบ`}
                      </p>
                    </TableCell>
                    <TableCell>{batch.branchName}</TableCell>
                    <TableCell className="text-right font-semibold text-amber-700">
                      {batch.unused}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-emerald-700">
                      {batch.activated}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {fmtDateTime(batch.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedBatchId(batch.id)}
                      >
                        เปิดดู
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!batches.isLoading && (batches.data?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-28 text-center text-muted-foreground"
                    >
                      ยังไม่มีชุดบัตร กำหนดจำนวนแล้วกดสร้างชุดใหม่
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {selectedBatchId !== null && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileArchive className="size-5 text-primary" />{" "}
                {detail.data?.batch.batchCode ?? "กำลังโหลดชุดบัตร..."}
              </CardTitle>
              {detail.data && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {detail.data.batch.label || "ไม่มีหมายเหตุ"} ·{" "}
                  {detail.data.cards.length} ใบ
                </p>
              )}
            </div>
            <Button
              disabled={!detail.data || downloading}
              onClick={() => void downloadPackage()}
            >
              {downloading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Download className="mr-2 size-4" />
              )}
              ดาวน์โหลด Data Merge (.zip)
            </Button>
          </CardHeader>
          {detail.data && (
            <CardContent className="grid gap-5 xl:grid-cols-[minmax(360px,560px)_minmax(0,1fr)]">
              <div className="space-y-3">
                {previewCard && (
                  <UnactivatedCardPreview
                    memberCode={previewCard.memberCode}
                    logoUrl={logoUrl}
                  />
                )}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border p-3">
                    <ScanBarcode className="mb-1 size-4 text-primary" />
                    Barcode Code128 อยู่ใน ZIP ครบทุกใบ
                  </div>
                  <div className="rounded-xl border p-3">
                    <QrCode className="mb-1 size-4 text-primary" />
                    QR ใช้เลขเดียวกับหน้าบัตรทุกใบ
                  </div>
                </div>
              </div>
              <div className="max-h-[840px] overflow-auto rounded-xl border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>เลขบัตร</TableHead>
                      <TableHead>สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.data.cards.map((card, index) => (
                      <TableRow
                        key={card.id}
                        className={
                          previewCard?.id === card.id
                            ? "cursor-pointer bg-violet-50"
                            : "cursor-pointer"
                        }
                        aria-selected={previewCard?.id === card.id}
                        onClick={() => setPreviewCardId(card.id)}
                      >
                        <TableCell>{index + 1}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono font-semibold">
                          {formatMemberCode(card.memberCode)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              card.status === "unused" ? "secondary" : "default"
                            }
                          >
                            {card.status === "unused"
                              ? "ยังไม่เปิดใช้งาน"
                              : card.status === "activated"
                                ? "เปิดใช้งานแล้ว"
                                : "ยกเลิก"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

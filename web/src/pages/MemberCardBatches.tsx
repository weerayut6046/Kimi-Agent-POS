import { useEffect, useMemo, useRef, useState } from "react";
import "@/styles/member-card-batches.css";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import {
  BadgePlus,
  ChevronRight,
  History,
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

  const brand = (
    <div className="flex items-center gap-[2.3cqw]">
      <div className="grid size-[10cqw] shrink-0 place-items-center overflow-hidden rounded-[2cqw] bg-white p-[0.75cqw] text-[4.4cqw] font-extrabold text-blue-900">
        {logoUrl ? (
          <img src={logoUrl} alt="KY" className="size-full object-contain" />
        ) : (
          "KY"
        )}
      </div>
      <div>
        <p className="text-[4cqw] font-bold leading-tight tracking-wide">
          KY MEMBER CLUB
        </p>
        <p className="text-[2.6cqw] text-cyan-100">บัตรสมาชิกสะสมแต้ม</p>
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-[560px] space-y-4">
      <section className="space-y-2 [container-type:inline-size]">
        <h3 className="text-sm font-semibold">ภาพบัตรด้านหน้า</h3>
        <div className="member-batch-proof">
          {brand}
          <div className="grid flex-1 grid-cols-[minmax(0,1fr)_24%] items-end gap-[3cqw]">
            <div className="min-w-0">
              <p className="text-[2.2cqw] font-medium tracking-widest text-cyan-100">
                CARD NUMBER
              </p>
              <p className="whitespace-nowrap font-mono text-[4.4cqw] font-bold leading-normal">
                {formatMemberCode(memberCode)}
              </p>
              <p className="text-[2.3cqw] text-cyan-100">
                ใช้แต้มได้ทุกสาขา · เปิดใช้งานก่อนใช้สิทธิ์
              </p>
              <div className="mt-[2cqw] rounded-[1.6cqw] bg-white px-[2.5cqw] py-[1.5cqw]">
                <svg
                  ref={barcodeRef}
                  className="h-[7cqw] w-full"
                  aria-label={`Barcode ${memberCode}`}
                />
              </div>
            </div>
            <div className="rounded-[2cqw] bg-white p-[1cqw]">
              {qrUrl && (
                <img
                  src={qrUrl}
                  alt={`QR ${memberCode}`}
                  className="aspect-square w-full"
                />
              )}
            </div>
          </div>
        </div>
      </section>
      <section className="space-y-2 [container-type:inline-size]">
        <h3 className="text-sm font-semibold">ภาพบัตรด้านหลัง</h3>
        <div className="member-batch-proof">
          {brand}
          <div className="grid flex-1 grid-cols-[minmax(0,1fr)_24%] items-center gap-[3cqw]">
            <div className="min-w-0">
              <p className="mb-[1cqw] text-[3cqw] font-bold">
                เงื่อนไขการใช้งาน
              </p>
              <ul className="list-inside list-disc text-[2.6cqw] leading-snug text-cyan-50">
                <li>ทุก 100 บาท รับ 1 แต้ม</li>
                <li>1 แต้ม ใช้เป็นส่วนลดได้ 1 บาท</li>
                <li>บัตรและแต้มมีอายุ 1 ปีนับจากวันเปิดใช้</li>
                <li>ใช้บัตรและแต้มได้ทุกสาขา</li>
              </ul>
            </div>
            <div className="rounded-[2cqw] bg-white p-[1cqw]">
              {qrUrl && (
                <img
                  src={qrUrl}
                  alt={`QR หลังบัตร ${memberCode}`}
                  className="aspect-square w-full"
                />
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-[2cqw] border-t border-white/25 pt-[1.5cqw]">
            <p className="font-mono text-[2.7cqw] font-bold">
              {formatMemberCode(memberCode)}
            </p>
            <p className="text-[2.1cqw] text-cyan-100">
              กรุณาเก็บบัตรไว้กับผู้ถือบัตร
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function focusBatchDetails(section: HTMLElement | null) {
  if (!section) return;
  section.focus({ preventScroll: true });
  section.scrollIntoView({ block: "start" });
}

export default function MemberCardBatches() {
  const utils = trpc.useUtils();
  const [quantity, setQuantity] = useState("100");
  const [label, setLabel] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [previewCardId, setPreviewCardId] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selectedBatchId !== null) focusBatchDetails(detailRef.current);
  }, [selectedBatchId]);
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
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4 sm:space-y-5">
      <header className="overflow-hidden rounded-3xl border border-slate-800 bg-[#10243c] text-white shadow-sm">
        <div className="relative isolate flex min-h-32 items-center justify-between gap-3 bg-linear-to-r from-[#10243c] via-[#16344d] to-[#175871] px-4 py-5 sm:min-h-40 sm:px-8">
          <div className="relative z-10 min-w-0 max-w-xl">
            <h1 className="font-heading text-[clamp(1.35rem,4vw,2.15rem)] font-bold leading-tight">
              สร้างชุดบัตรสมาชิก
            </h1>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-200 sm:text-sm">
              บัตร PVC แบบไม่มีแถบแม่เหล็ก พร้อมเลขบัตร 16 หลัก บาร์โค้ดและ QR
              ใช้ได้ทุกสาขา
            </p>
          </div>
          <div aria-hidden="true" className="member-batch-art">
            <div className="member-batch-art-back" />
            <div className="member-batch-art-front">
              <strong>KY</strong>
              <span>MEMBER CLUB</span>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-white/15 border-t border-white/10 px-1 py-3 sm:px-3 sm:py-4">
          {[
            { title: "บัตรที่สร้าง", value: summary.cards, dot: "bg-sky-300" },
            { title: "รอเปิดใช้", value: summary.unused, dot: "bg-amber-300" },
            {
              title: "เปิดใช้แล้ว",
              value: summary.activated,
              dot: "bg-emerald-300",
            },
          ].map(({ title, value, dot }) => (
            <div key={title} className="min-w-0 px-2.5 sm:px-5">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-200 sm:text-sm">
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${dot}`}
                />
                {title}
              </dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums leading-tight sm:text-3xl">
                {batches.data ? value.toLocaleString("th-TH") : "—"}
              </dd>
            </div>
          ))}
        </dl>
        {batches.data?.length === 50 && (
          <p className="px-4 pb-3 text-xs text-slate-300 sm:px-8">
            สรุปจาก 50 ชุดล่าสุด
          </p>
        )}
      </header>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(20rem,0.86fr)_minmax(0,1.14fr)]">
        <section
          aria-labelledby="batch-create-title"
          className="min-w-0 rounded-2xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6"
        >
          <div className="mb-5 flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">
              <BadgePlus aria-hidden="true" className="size-5" />
            </span>
            <h2
              id="batch-create-title"
              className="font-heading text-lg font-bold"
            >
              สร้างชุดใหม่
            </h2>
          </div>
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              submit();
            }}
          >
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <Label htmlFor="card-batch-quantity">จำนวนบัตร</Label>
                <span
                  id="batch-quantity-hint"
                  className="text-xs text-muted-foreground"
                >
                  1–500 ใบต่อชุด
                </span>
              </div>
              <div className="relative">
                <Input
                  id="card-batch-quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={500}
                  step={1}
                  required
                  aria-invalid={!quantityValid}
                  aria-describedby={
                    quantityValid
                      ? "batch-quantity-hint"
                      : "batch-quantity-error"
                  }
                  className="h-12 pe-12 text-lg font-semibold tabular-nums"
                  value={quantity}
                  onChange={event => setQuantity(event.target.value)}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 end-3.5 grid place-items-center text-sm text-muted-foreground"
                >
                  ใบ
                </span>
              </div>
              <div
                role="group"
                aria-label="เลือกจำนวนบัตร"
                className="mt-2 grid grid-cols-4 gap-1 rounded-xl bg-muted/65 p-1"
              >
                {[50, 100, 250, 500].map(value => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={parsedQuantity === value}
                    onClick={() => setQuantity(String(value))}
                    className="min-h-11 rounded-lg px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-[#145373] aria-pressed:text-white aria-pressed:shadow-sm"
                  >
                    {value} ใบ
                  </button>
                ))}
              </div>
              {!quantityValid && (
                <p
                  id="batch-quantity-error"
                  role="alert"
                  className="mt-1.5 text-xs text-destructive"
                >
                  กรอกจำนวนเต็มตั้งแต่ 1 ถึง 500 ใบ
                </p>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="card-batch-label">ชื่อชุด / หมายเหตุ</Label>
                <span className="text-xs text-muted-foreground">ไม่บังคับ</span>
              </div>
              <Input
                id="card-batch-label"
                maxLength={80}
                placeholder="เช่น บัตรสมาชิกสาขาหลัก"
                value={label}
                onChange={event => setLabel(event.target.value)}
              />
            </div>
            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-teal-700 dark:text-teal-300"
              />
              ระบบจองเลขบัตรไม่ซ้ำ เปิดใช้บัตรเมื่อสมัครสมาชิก
            </p>
            <Button
              type="submit"
              className="h-12 w-full rounded-xl bg-[#145373] text-base text-white hover:bg-[#0c405c]"
              disabled={!quantityValid || createBatch.isPending}
            >
              {createBatch.isPending ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <BadgePlus aria-hidden="true" className="size-4" />
              )}
              {createBatch.isPending
                ? "กำลังสร้างชุดบัตร…"
                : quantityValid
                  ? `สร้างชุด ${parsedQuantity} ใบ`
                  : "สร้างชุดบัตร"}
            </Button>
          </form>
        </section>

        <section
          aria-labelledby="batch-history-title"
          className="min-w-0 overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm"
        >
          <div className="flex items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
                <History aria-hidden="true" className="size-5" />
              </span>
              <h2
                id="batch-history-title"
                className="font-heading text-lg font-bold"
              >
                ประวัติชุดบัตร
              </h2>
            </div>
            {batches.data && (
              <span className="text-xs text-muted-foreground">
                {batches.data.length} ชุดล่าสุด
              </span>
            )}
          </div>
          {batches.isLoading ? (
            <p role="status" className="p-5 text-sm text-muted-foreground">
              กำลังโหลดชุดบัตร…
            </p>
          ) : batches.isError && !batches.data ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 p-5 text-sm"
            >
              โหลดประวัติชุดบัตรไม่ได้{" "}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void batches.refetch()}
              >
                ลองอีกครั้ง
              </Button>
            </div>
          ) : !batches.data?.length ? (
            <div className="px-4 py-7 text-center">
              <Layers3
                aria-hidden="true"
                className="mx-auto mb-2 size-6 text-muted-foreground"
              />
              <p className="text-sm font-medium">ยังไม่มีชุดบัตร</p>
              <p className="mt-1 text-xs text-muted-foreground">
                ชุดบัตรที่สร้างจะปรากฏที่นี่
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {batches.data.map(batch => (
                <li key={batch.id}>
                  <button
                    type="button"
                    aria-label={`เปิดดูชุด ${batch.batchCode}`}
                    aria-expanded={selectedBatchId === batch.id}
                    onClick={() => {
                      if (selectedBatchId === batch.id)
                        focusBatchDetails(detailRef.current);
                      else setSelectedBatchId(batch.id);
                    }}
                    className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-4 py-4 text-start transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary aria-expanded:bg-sky-50/75 sm:px-6 dark:aria-expanded:bg-sky-950/40"
                  >
                    <span className="min-w-0">
                      <span className="block wrap-anywhere text-sm font-semibold">
                        {batch.label || batch.batchCode}
                      </span>
                      {batch.label && (
                        <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                          {batch.batchCode}
                        </span>
                      )}
                      <span className="mt-1 block wrap-anywhere text-xs leading-relaxed text-muted-foreground">
                        {batch.branchName} · {fmtDateTime(batch.createdAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
                      {batch.quantity.toLocaleString("th-TH")} ใบ{" "}
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 text-muted-foreground"
                      />
                    </span>
                    <span className="col-span-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        รอเปิดใช้ {batch.unused}
                      </span>
                      <span className="rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        เปิดใช้แล้ว {batch.activated}
                      </span>
                      {batch.void > 0 && (
                        <span className="rounded-md bg-muted px-2 py-1">
                          ยกเลิก {batch.void}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {selectedBatchId !== null && (
        <section
          ref={detailRef}
          tabIndex={-1}
          aria-label="รายละเอียดชุดบัตร"
          className="min-w-0 scroll-mt-20 rounded-2xl focus:outline-none"
        >
          <Card className="min-w-0">
            <CardHeader className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 break-all text-base sm:text-lg">
                  <FileArchive className="size-5 text-primary" />{" "}
                  {detail.data?.batch.batchCode ??
                    (detail.isError
                      ? "โหลดรายละเอียดชุดบัตรไม่ได้"
                      : "กำลังโหลดชุดบัตร…")}
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
            {detail.isError && !detail.data && (
              <CardContent>
                <Button variant="outline" onClick={() => void detail.refetch()}>
                  ลองอีกครั้ง
                </Button>
              </CardContent>
            )}
            {detail.data && (
              <CardContent className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(360px,560px)_minmax(0,1fr)]">
                <div className="space-y-3">
                  {previewCard && (
                    <UnactivatedCardPreview
                      key={previewCard.id}
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
                <div className="min-w-0 max-h-[65vh] overflow-auto rounded-xl border">
                  <Table className="table-fixed max-sm:min-w-0 [&_th]:px-2 [&_td]:px-2 [&_td]:py-1.5">
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-[11%]">#</TableHead>
                        <TableHead>เลขบัตร</TableHead>
                        <TableHead className="w-[33%]">สถานะ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.data.cards.map((card, index) => (
                        <TableRow
                          key={card.id}
                          className={
                            previewCard?.id === card.id
                              ? "cursor-pointer bg-sky-50 dark:bg-sky-950"
                              : "cursor-pointer"
                          }
                          aria-selected={previewCard?.id === card.id}
                          onClick={() => setPreviewCardId(card.id)}
                        >
                          <TableCell>{index + 1}</TableCell>
                          <TableCell className="px-1 font-mono font-semibold">
                            <button
                              type="button"
                              aria-pressed={previewCard?.id === card.id}
                              onClick={() => setPreviewCardId(card.id)}
                              className="min-h-11 rounded text-xs focus-visible:outline-2 focus-visible:outline-primary sm:text-sm"
                            >
                              {formatMemberCode(card.memberCode)}
                            </button>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                card.status === "unused"
                                  ? "secondary"
                                  : "default"
                              }
                            >
                              {card.status === "unused"
                                ? "รอเปิดใช้"
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
        </section>
      )}
    </div>
  );
}

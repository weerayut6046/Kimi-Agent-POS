import { useId, useRef, useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/providers/trpc";
import { printA4FormElement } from "@/lib/printDoc";
import { debtMethodLabel, fmtDateKeyTH, fmtMoney } from "@/lib/format";
import { bangkokDateKey } from "@contracts/promotion";
import { creditStatusLabel, type CreditEventKind, type CreditStatus } from "@contracts/credit";

type CaseFile = inferRouterOutputs<AppRouter>["credit"]["caseFile"];
type DocumentKind = "statement" | "notice" | "evidence";

const docTitles: Record<DocumentKind, string> = {
  statement: "ใบสรุปยอดซื้อเชื่อและยอดคงเหลือ",
  notice: "หนังสือแจ้งยอดค้างเกินกำหนด",
  evidence: "แฟ้มหลักฐานเครดิตสำหรับผู้พิจารณาคดี",
};

const eventLabel: Record<CreditEventKind, string> = {
  approval: "อนุมัติหรือปรับเงื่อนไขเครดิต",
  suspension: "พักเครดิต",
  notice: "ส่งหนังสือแจ้งยอด",
  dispute: "บันทึกข้อโต้แย้ง",
  legal_review: "ส่งข้อเท็จจริงให้ตรวจทางกฎหมาย",
  sale_voided: "ยกเลิกบิล",
  payment_reversed: "กลับรายการรับชำระ",
};

const referenceFields = [
  ["applicationRef", "ใบสมัครเปิดเครดิต (FC01)"],
  ["identityRef", "หลักฐานยืนยันตัวผู้ซื้อ"],
  ["agreementRef", "สัญญาซื้อเชื่อที่ลงนามแล้ว (FC03)"],
  ["receiversRef", "รายชื่อรถและผู้มีสิทธิรับน้ำมัน (FC04)"],
  ["privacyNoticeRef", "หลักฐานแจ้งการใช้ข้อมูล (FC12)"],
] as const;

const selectStyle = "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline focus-visible:outline-primary";

function documentDate(date: Date | string) {
  return fmtDateKeyTH(bangkokDateKey(date));
}

function CreditPrintDocument({
  data,
  kind,
  settings,
}: {
  data: CaseFile;
  kind: DocumentKind;
  settings?: Record<string, string>;
}) {
  const notice = kind === "notice";
  const evidence = kind === "evidence";
  const invoices = notice
    ? data.invoices.filter(invoice => invoice.isOverdue)
    : data.invoices.filter(invoice => invoice.remaining > 0);
  const terms = data.account?.terms;
  return (
    <article className="space-y-4 bg-white text-sm leading-relaxed text-black">
      <header className="border-b border-slate-400 pb-3">
        <p className="font-semibold">{settings?.shop_name || "สถานีบริการน้ำมัน"}</p>
        <p>{settings?.shop_address}</p>
        <h1 className="mt-2 text-xl font-bold">{docTitles[kind]}</h1>
        <p>{evidence ? "สำหรับตรวจสอบและแนบหลักฐานต้นฉบับ" : "ร่างสำหรับตรวจยอดและลงนาม"}</p>
        <p>ข้อมูล ณ วันที่ {documentDate(data.asOf)} (เวลาประเทศไทย)</p>
      </header>
      <section>
        <p>ลูกค้า {data.customer.name}</p>
        {data.customer.address && <p className="whitespace-pre-line">{data.customer.address}</p>}
        {terms && <p>อ้างอิงสัญญา {terms.agreementRef}</p>}
        <p>ยอดคงค้าง ฿{fmtMoney(data.outstanding)} · เกินกำหนด ฿{fmtMoney(data.overdue)}</p>
        {data.unknownDue > 0 && <p>ยอดเดิมที่ไม่มีวันครบกำหนด ฿{fmtMoney(data.unknownDue)}</p>}
      </section>
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-400">
            <th scope="col">เลขที่บิล</th><th scope="col">วันส่งมอบ</th>
            <th scope="col">ครบกำหนด</th><th scope="col" className="text-right">คงเหลือ (บาท)</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map(invoice => (
            <tr key={invoice.id} className="break-inside-avoid border-b border-slate-200">
              <td>{invoice.receiptNo}</td><td>{documentDate(invoice.createdAt)}</td>
              <td>{invoice.creditDueOn ? fmtDateKeyTH(invoice.creditDueOn) : "รอตรวจหลักฐาน"}</td>
              <td className="text-right">{fmtMoney(invoice.remaining)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {notice && (
        <section className="space-y-2">
          <p>เรียน {data.customer.name}</p>
          <p>ขอให้ตรวจสอบและชำระยอดที่เกินกำหนดตามรายการข้างต้นเป็นเงิน {fmtMoney(data.overdue)} บาท ตามช่องทางที่ตกลงในสัญญา หากได้ชำระแล้วหรือมีรายการที่ต้องตรวจสอบ โปรดติดต่อสถานีบริการพร้อมหลักฐานเพื่อกระทบยอด</p>
          <p>ผู้ติดต่อ {settings?.shop_phone || "________________________"}</p>
          <p className="pt-5">ลงชื่อ __________________________ ผู้มีอำนาจของผู้ขาย</p>
        </section>
      )}
      {evidence && (
        <>
          <section className="space-y-1">
            <h2 className="font-bold">เอกสารที่ต้องแนบต้นฉบับหรือสำเนาตรวจสอบได้</h2>
            {terms && (
              <ul className="list-inside list-disc">
                {referenceFields.map(([key, label]) => <li key={key}>{label} {terms[key]}</li>)}
                {terms.authorityRef && <li>หลักฐานอำนาจลงนาม {terms.authorityRef}</li>}
              </ul>
            )}
            <p>แนบใบรับน้ำมัน ใบวางบิล ใบรับชำระ หลักฐานส่งหนังสือ และหลักฐานข้อโต้แย้งตามรายการจริง</p>
          </section>
          <section className="space-y-1">
            <h2 className="font-bold">ประวัติบิลและหลักฐานส่งมอบ</h2>
            {data.documents.map(doc => (
              <p className="break-inside-avoid break-words" key={doc.id}>
                {doc.receiptNo} · {documentDate(doc.createdAt)} · ฿{fmtMoney(doc.total)}
                {" · "}{doc.status === "voided" ? "ยกเลิก" : doc.transactionType === "return" ? "คืนสินค้า" : "ขายเชื่อ"}
                {doc.creditProof && ` · สัญญา ${doc.creditProof.agreementRef} · ใบรับ ${doc.creditProof.deliveryRef}`}
                {doc.returnReason && ` · เหตุผล ${doc.returnReason}`}
              </p>
            ))}
          </section>
          <section className="space-y-1">
            <h2 className="font-bold">การรับชำระ</h2>
            {data.payments.map(payment => (
              <p className="break-inside-avoid break-words" key={payment.id}>
                {payment.paymentNo} · {documentDate(payment.createdAt)} · ฿{fmtMoney(payment.amount)}
                {" · "}{debtMethodLabel[payment.method]} · {payment.staffName || "-"}
                {payment.saleId && ` · บิล ${data.documents.find(doc => doc.id === payment.saleId)?.receiptNo ?? payment.saleId}`}
                {payment.note && ` · ${payment.note}`}
              </p>
            ))}
          </section>
          <section className="space-y-1">
            <h2 className="font-bold">ลำดับการติดตามและการตรวจข้อเท็จจริง</h2>
            {[...data.events].reverse().map(event => (
              <div key={event.id} className="break-inside-avoid break-words border-b border-slate-200 py-1.5">
                <p>{documentDate(event.createdAt)} · {eventLabel[event.kind]} · {event.actorName}</p>
                {event.data.occurredOn && <p>วันเกิดเหตุหรือวันส่ง {fmtDateKeyTH(event.data.occurredOn)}</p>}
                {event.data.reference && <p>หลักฐานอ้างอิง {event.data.reference}</p>}
                {event.data.terms && <p>สัญญา {event.data.terms.agreementRef} · วงเงิน ฿{fmtMoney(event.data.terms.limit)} · {event.data.terms.days} วัน</p>}
                {event.data.reviewRoute && <p>{event.data.reviewRoute === "civil" ? "พิจารณาใช้สิทธิทางแพ่ง" : "ตรวจข้อเท็จจริงกรณีสงสัยการหลอกลวง"}</p>}
                {event.data.payment && (
                  <p>รายการเดิม {event.data.payment.paymentNo} · {documentDate(event.data.payment.receivedAt)} · ฿{fmtMoney(event.data.payment.amount)} · {event.data.payment.staffName}</p>
                )}
                {event.data.notes && <p className="whitespace-pre-wrap">{event.data.notes}</p>}
              </div>
            ))}
          </section>
          <p className="border-t pt-2">ให้ผู้รับผิดชอบกระทบยอดและตรวจต้นฉบับ อำนาจผู้ยื่น และข้อเท็จจริงก่อนส่งภายนอก</p>
        </>
      )}
      <p className="text-xs">ยอดแยกบิลใช้การรับชำระที่ระบุบิล และจัดสรรยอดที่ไม่ระบุไปยังบิลเก่าก่อน กรุณากระทบยอดตามหลักฐานจริง</p>
    </article>
  );
}

export function CreditAccountPanel({
  customerId,
  status,
  settings,
}: {
  customerId: number;
  status: CreditStatus;
  settings?: Record<string, string>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"account" | "followUp">("account");
  const [kind, setKind] = useState<"notice" | "dispute" | "civil" | "suspected_fraud">("notice");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const statement = useRef<HTMLDivElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const evidence = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const file = trpc.credit.caseFile.useQuery({ customerId }, { enabled: open });
  const onSuccess = () => {
    setError("");
    setMessage("บันทึกแล้ว");
    void utils.credit.detail.invalidate({ customerId });
    void utils.credit.checkout.invalidate({ customerId });
    void utils.credit.summary.invalidate();
    void utils.credit.caseFile.invalidate({ customerId });
  };
  const onError = (err: { message: string }) => {
    setMessage("");
    setError(err.message);
  };
  const approve = trpc.credit.approveAccount.useMutation({ onSuccess, onError });
  const suspend = trpc.credit.suspendAccount.useMutation({ onSuccess, onError });
  const followUp = trpc.credit.recordFollowUp.useMutation({ onSuccess, onError });
  const busy = approve.isPending || suspend.isPending || followUp.isPending;
  const terms = file.data?.account?.terms;
  const [buyerType, setBuyerType] = useState<"individual" | "company" | null>(null);
  const type = buyerType ?? terms?.buyerType ?? "individual";
  const today = bangkokDateKey(new Date());

  function approveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (field: string) => String(form.get(field) ?? "").trim();
    if (!form.has("verified")) return;
    approve.mutate({
      customerId, verified: true, buyerType: type, limit: Number(value("limit")), days: Number(value("days")),
      signedOn: value("signedOn"), agreementRef: value("agreementRef"), applicationRef: value("applicationRef"),
      identityRef: value("identityRef"), receiversRef: value("receiversRef"), privacyNoticeRef: value("privacyNoticeRef"),
      authorityRef: value("authorityRef") || undefined,
    });
  }

  function recordFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = {
      customerId,
      occurredOn: String(form.get("occurredOn")),
      reference: String(form.get("reference")).trim(),
      notes: String(form.get("notes")).trim(),
    };
    followUp.mutate(kind === "notice" || kind === "dispute"
      ? { ...data, kind }
      : { ...data, kind: "legal_review", reviewRoute: kind });
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">การอนุมัติเครดิตและเอกสาร</h3>
          <p className="text-sm text-muted-foreground">{creditStatusLabel[status]}</p>
        </div>
        <Button type="button" variant="outline" className="min-h-11" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          {open ? "ย่อรายละเอียด" : "จัดการเครดิต"}
        </Button>
      </div>
      {open && (
        <div id={id} className="space-y-4 border-t pt-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={tab === "account" ? "default" : "outline"} aria-pressed={tab === "account"} onClick={() => setTab("account")}>อนุมัติและพักเครดิต</Button>
            <Button type="button" variant={tab === "followUp" ? "default" : "outline"} aria-pressed={tab === "followUp"} onClick={() => setTab("followUp")}>ติดตามและพิมพ์เอกสาร</Button>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
          {file.isPending && <p role="status" className="text-sm">กำลังโหลดข้อมูลเครดิต</p>}
          {file.isError && <p role="alert" className="text-sm text-destructive">{file.error.message}</p>}
          {file.data && tab === "account" && (
            <>
              <p className="text-sm text-muted-foreground">
                ตรวจสัญญาที่ลงนามและเอกสารจริงก่อนอนุมัติ ใช้เลขอ้างอิงหรือรหัสที่เก็บเอกสารในช่องด้านล่าง
              </p>
              <form key={file.data.account?.updatedAt.toISOString() ?? "new"} className="space-y-4" onSubmit={approveAccount}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm font-medium">
                    ประเภทผู้ซื้อ
                    <select className={selectStyle} value={type} onChange={event => setBuyerType(event.target.value === "company" ? "company" : "individual")}>
                      <option value="individual">บุคคลธรรมดา</option>
                      <option value="company">นิติบุคคล</option>
                    </select>
                  </label>
                  <label className="space-y-1.5 text-sm font-medium">
                    วงเงินค้างรวม (บาท)
                    <Input name="limit" type="number" min="0.01" max="1000000000" step="0.01" defaultValue={terms?.limit} required />
                  </label>
                  <label className="space-y-1.5 text-sm font-medium">
                    กำหนดชำระ (วันปฏิทินนับจากวันส่งมอบ)
                    <Input name="days" type="number" min="1" max="365" defaultValue={terms?.days ?? 30} required />
                  </label>
                  <label className="space-y-1.5 text-sm font-medium">
                    วันที่ลงนามสัญญา
                    <Input name="signedOn" type="date" max={today} defaultValue={terms?.signedOn} required />
                  </label>
                  {referenceFields.map(([key, label]) => (
                    <label className="space-y-1.5 text-sm font-medium" key={key}>
                      {label}
                      <Input name={key} maxLength={160} defaultValue={terms?.[key]} required />
                    </label>
                  ))}
                  {type === "company" && (
                    <label className="space-y-1.5 text-sm font-medium">
                      หนังสือรับรองและอำนาจลงนาม
                      <Input name="authorityRef" maxLength={160} defaultValue={terms?.authorityRef} required />
                    </label>
                  )}
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="verified" className="mt-1 size-4" required />
                  ตรวจตัวผู้ซื้อ อำนาจลงนาม และเงื่อนไขกับต้นฉบับแล้ว
                </label>
                <Button type="submit" className="min-h-11" disabled={busy}>{approve.isPending ? "กำลังบันทึก" : "บันทึกอนุมัติเครดิต"}</Button>
              </form>
              {file.data.account && status !== "suspended" && (
                <form className="flex flex-wrap items-end gap-2 border-t pt-4" onSubmit={event => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  suspend.mutate({ customerId, reason: String(form.get("reason")).trim() });
                }}>
                  <div className="min-w-40 flex-1 space-y-1.5">
                    <Label htmlFor={id + "-reason"}>เหตุผลที่พักเครดิต</Label>
                    <Input id={id + "-reason"} name="reason" required minLength={3} maxLength={500} />
                  </div>
                  <Button type="submit" variant="outline" className="min-h-11" disabled={busy}>พักเครดิต</Button>
                </form>
              )}
            </>
          )}
          {file.data && tab === "followUp" && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => statement.current && printA4FormElement(statement.current)}>พิมพ์สรุปยอด</Button>
                <Button type="button" variant="outline" disabled={file.data.overdue <= 0} onClick={() => notice.current && printA4FormElement(notice.current)}>พิมพ์ร่างแจ้งยอดเกินกำหนด</Button>
                <Button type="button" variant="outline" onClick={() => evidence.current && printA4FormElement(evidence.current)}>พิมพ์แฟ้มหลักฐาน</Button>
              </div>
              <p className="text-sm text-muted-foreground">
                ตรวจยอดและข้อโต้แย้งก่อนส่งหนังสือ ใช้แฟ้มหลักฐานเพื่อพิจารณาไกล่เกลี่ยหรือดำเนินการทางแพ่ง หากมีหลักฐานการหลอกลวงให้บันทึกข้อเท็จจริงเพื่อให้ผู้เชี่ยวชาญตรวจ
              </p>
              {file.data.account && (
                <form className="space-y-3" onSubmit={recordFollowUp}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5 text-sm font-medium">
                      ประเภทบันทึก
                      <select className={selectStyle} value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
                        <option value="notice">บันทึกการส่งหนังสือ</option>
                        <option value="dispute">บันทึกข้อโต้แย้ง</option>
                        <option value="civil">ส่งตรวจเพื่อใช้สิทธิทางแพ่ง</option>
                        <option value="suspected_fraud">ส่งตรวจข้อเท็จจริงกรณีสงสัยการหลอกลวง</option>
                      </select>
                    </label>
                    <label className="space-y-1.5 text-sm font-medium">
                      วันที่ส่งหรือเกิดเหตุ
                      <Input name="occurredOn" type="date" max={today} defaultValue={today} required />
                    </label>
                  </div>
                  <label className="block space-y-1.5 text-sm font-medium">
                    เลขเอกสารหรือหลักฐานอ้างอิง
                    <Input name="reference" required maxLength={160} />
                  </label>
                  <label className="block space-y-1.5 text-sm font-medium">
                    {kind === "suspected_fraud" ? "ข้อมูลที่อ้างก่อนส่งมอบ เหตุที่เชื่อ และวันรู้เรื่องและรู้ตัวผู้เกี่ยวข้อง" : "รายละเอียด ผู้รับหนังสือหรือข้อเท็จจริงที่ตรวจสอบได้"}
                    <Textarea name="notes" minLength={kind === "civil" || kind === "suspected_fraud" ? 20 : 5} maxLength={2000} required />
                  </label>
                  <Button type="submit" className="min-h-11" disabled={busy}>{followUp.isPending ? "กำลังบันทึก" : "บันทึกการติดตาม"}</Button>
                </form>
              )}
              <ul className="space-y-1.5 text-sm" aria-label="ประวัติแฟ้มเครดิต">
                {file.data.events.slice(0, 10).map(event => (
                  <li key={event.id} className="break-words rounded-lg bg-muted/60 p-2.5">
                    {documentDate(event.createdAt)} · {eventLabel[event.kind]} · {event.actorName}
                    {event.data.reference && ` · ${event.data.reference}`}
                    {event.data.notes && <p className="text-muted-foreground">{event.data.notes}</p>}
                  </li>
                ))}
              </ul>
              <div className="hidden">
                <div ref={statement}><CreditPrintDocument data={file.data} kind="statement" settings={settings} /></div>
                <div ref={notice}><CreditPrintDocument data={file.data} kind="notice" settings={settings} /></div>
                <div ref={evidence}><CreditPrintDocument data={file.data} kind="evidence" settings={settings} /></div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

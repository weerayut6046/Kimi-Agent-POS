import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  History,
  LoaderCircle,
  MapPin,
  Medal,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  TriangleAlert,
  WalletCards,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDateTH, fmtDateTime, tierLabel } from "@/lib/format";
import "@/index.css";

const transactionLabels = {
  earn: "รับแต้ม",
  redeem: "ใช้แต้ม",
  adjust: "ปรับแต้ม",
  expire: "แต้มหมดอายุ",
} as const;

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

export default function CustomerLoyalty() {
  const [phone, setPhone] = useState("");
  const [submittedPhone, setSubmittedPhone] = useState("");
  const [formError, setFormError] = useState("");

  const lookup = trpc.membership.customerPoints.useInfiniteQuery(
    { phone: submittedPhone || "-", limit: 30 },
    {
      enabled: Boolean(submittedPhone),
      retry: false,
      getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    }
  );

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "ตรวจสอบแต้มสมาชิก | PumpPOS";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const firstPage = lookup.data?.pages[0];
  const member = firstPage?.member;
  const summary = firstPage?.summary;
  const transactions = useMemo(
    () => lookup.data?.pages.flatMap(page => page.transactions) ?? [],
    [lookup.data]
  );

  const submitLookup = (event: FormEvent) => {
    event.preventDefault();
    const digits = phoneDigits(phone);
    if (digits.length < 9 || digits.length > 11) {
      setFormError("กรุณากรอกเบอร์โทรศัพท์สมาชิกให้ถูกต้อง");
      return;
    }
    setFormError("");
    const normalizedInput = phone.trim();
    if (submittedPhone === normalizedInput) {
      void lookup.refetch();
    } else {
      setSubmittedPhone(normalizedInput);
    }
  };

  const resetLookup = () => {
    setPhone("");
    setSubmittedPhone("");
    setFormError("");
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_5%,rgba(124,58,237,0.36),transparent_30rem),radial-gradient(circle_at_90%_18%,rgba(6,182,212,0.25),transparent_28rem),linear-gradient(180deg,#081327_0%,#0f1e3c_36%,#f6f7fb_36%,#f6f7fb_100%)]" />
      <div className="surface-grid pointer-events-none absolute inset-x-0 top-0 h-[36vh] opacity-60" />

      <div className="relative mx-auto w-full max-w-3xl px-4 pb-12 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6 sm:pt-8">
        <header className="flex items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl border border-white/15 bg-white/10 shadow-lg backdrop-blur">
              <Star className="size-6 fill-cyan-300 text-cyan-300" />
            </div>
            <div>
              <p className="font-heading text-lg font-black tracking-tight">
                MEMBER CLUB
              </p>
              <p className="text-xs font-medium text-blue-200">
                เช็กแต้มง่าย ๆ ได้ทุกเวลา
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 sm:flex">
            <ShieldCheck className="size-4" /> ข้อมูลของคุณถูกปกปิด
          </div>
        </header>

        <section className="mt-8 text-white sm:mt-11">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-1.5 text-xs font-bold text-violet-100">
            <Sparkles className="size-3.5" /> LOYALTY POINTS
          </div>
          <h1 className="mt-4 max-w-xl font-heading text-3xl font-black leading-tight tracking-tight sm:text-5xl">
            แต้มของคุณ พร้อมให้ตรวจสอบแล้ว
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-blue-100/85 sm:text-base">
            กรอกเบอร์โทรศัพท์ที่สมัครสมาชิก เพื่อดูแต้มคงเหลือ
            และประวัติการรับ–ใช้แต้มทั้งหมด
          </p>
        </section>

        <section className="glass-panel relative mt-7 overflow-hidden rounded-[28px] p-4 sm:mt-9 sm:p-6">
          <div className="pointer-events-none absolute -right-16 -top-20 size-48 rounded-full bg-violet-300/20 blur-3xl" />
          <form className="relative" onSubmit={submitLookup}>
            <label
              htmlFor="customer-member-phone"
              className="text-sm font-bold text-slate-800"
            >
              เบอร์โทรศัพท์สมาชิก
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-violet-500" />
                <Input
                  id="customer-member-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  autoFocus={!submittedPhone}
                  maxLength={30}
                  value={phone}
                  onChange={event => {
                    setPhone(event.target.value);
                    setFormError("");
                  }}
                  placeholder="เช่น 0812345678"
                  className="h-14 rounded-2xl border-slate-200 bg-white pl-11 text-base shadow-sm focus-visible:ring-violet-500"
                  aria-invalid={Boolean(formError)}
                />
              </div>
              <Button
                type="submit"
                size="lg"
                disabled={lookup.isFetching && !lookup.isFetchingNextPage}
                className="h-14 rounded-2xl bg-gradient-to-r from-violet-600 to-blue-600 px-6 font-bold shadow-lg shadow-violet-200 hover:from-violet-700 hover:to-blue-700"
              >
                {lookup.isFetching && !lookup.isFetchingNextPage ? (
                  <LoaderCircle className="mr-2 size-5 animate-spin" />
                ) : (
                  <Search className="mr-2 size-5" />
                )}
                ตรวจสอบแต้ม
              </Button>
            </div>
            <div className="mt-2 flex items-start gap-2 text-xs leading-5 text-slate-500">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
              ระบบจะแสดงชื่อและเบอร์โทรแบบปกปิด และไม่บันทึกเบอร์ไว้บนอุปกรณ์นี้
            </div>
          </form>

          {(formError || lookup.error) && (
            <div
              role="alert"
              className="relative mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {formError || lookup.error?.message}
            </div>
          )}
        </section>

        {submittedPhone && !lookup.isLoading && firstPage && !member && (
          <section className="mt-5 rounded-[28px] border border-slate-200 bg-white p-7 text-center shadow-xl shadow-slate-200/50 sm:p-10">
            <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-amber-50 text-amber-600">
              <Phone className="size-7" />
            </div>
            <h2 className="mt-4 font-heading text-xl font-black text-slate-900">
              ไม่พบข้อมูลสมาชิก
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
              กรุณาตรวจสอบเบอร์โทรอีกครั้ง หรือติดต่อพนักงานหน้าร้านเพื่อแก้ไขข้อมูลสมาชิก
            </p>
            <Button className="mt-5 rounded-xl" variant="outline" onClick={resetLookup}>
              <RefreshCw className="mr-2 size-4" /> กรอกเบอร์ใหม่
            </Button>
          </section>
        )}

        {member && summary && (
          <div className="mt-5 space-y-5">
            <section className="relative overflow-hidden rounded-[30px] bg-gradient-to-br from-violet-700 via-blue-700 to-cyan-600 p-6 text-white shadow-2xl shadow-blue-200/50 sm:p-8">
              <div className="surface-dots pointer-events-none absolute inset-0 opacity-30" />
              <div className="pointer-events-none absolute -right-10 -top-14 size-52 rounded-full border border-white/15" />
              <div className="pointer-events-none absolute -bottom-24 right-20 size-48 rounded-full bg-cyan-200/15 blur-2xl" />
              <div className="relative flex flex-wrap items-start justify-between gap-5">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-blue-100">
                    <CheckCircle2 className="size-4 text-emerald-300" />
                    {member.maskedName} · {member.maskedPhone}
                  </div>
                  <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-blue-200">
                    แต้มคงเหลือ
                  </p>
                  <div className="mt-1 flex items-end gap-2">
                    <span className="font-heading text-5xl font-black tabular-nums sm:text-6xl">
                      {member.points.toLocaleString("th-TH")}
                    </span>
                    <span className="pb-1.5 text-lg font-bold text-blue-100">
                      แต้ม
                    </span>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-right backdrop-blur-sm">
                  <div className="flex items-center justify-end gap-1.5 text-xs text-blue-100">
                    <Medal className="size-4 text-amber-300" /> ระดับสมาชิก
                  </div>
                  <div className="mt-1 font-heading text-lg font-black">
                    {tierLabel[member.tier] ?? member.tier}
                  </div>
                </div>
              </div>
              <div className="relative mt-6 flex items-center gap-2 border-t border-white/15 pt-4 text-xs text-blue-100">
                <CalendarDays className="size-4" />
                {member.expired
                  ? `สมาชิกหมดอายุเมื่อ ${fmtDateTH(member.cardExpiresAt)}`
                  : `สมาชิกใช้ได้ถึง ${fmtDateTH(member.cardExpiresAt)}`}
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                <div className="grid size-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                  <ArrowUpRight className="size-5" />
                </div>
                <p className="mt-3 text-xs font-semibold text-slate-500">
                  รับแต้มสะสม
                </p>
                <p className="mt-0.5 text-xl font-black text-emerald-700">
                  +{summary.totalEarned.toLocaleString("th-TH")}
                </p>
              </div>
              <div className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
                <div className="grid size-9 place-items-center rounded-xl bg-rose-50 text-rose-600">
                  <ArrowDownRight className="size-5" />
                </div>
                <p className="mt-3 text-xs font-semibold text-slate-500">
                  ใช้แต้มแล้ว
                </p>
                <p className="mt-0.5 text-xl font-black text-rose-700">
                  -{summary.totalUsed.toLocaleString("th-TH")}
                </p>
              </div>
              <div className="col-span-2 rounded-2xl border border-violet-100 bg-white p-4 shadow-sm sm:col-span-1">
                <div className="grid size-9 place-items-center rounded-xl bg-violet-50 text-violet-600">
                  <History className="size-5" />
                </div>
                <p className="mt-3 text-xs font-semibold text-slate-500">
                  รายการทั้งหมด
                </p>
                <p className="mt-0.5 text-xl font-black text-violet-700">
                  {summary.transactionCount.toLocaleString("th-TH")} รายการ
                </p>
              </div>
            </section>

            <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-xl shadow-slate-200/45">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
                <div>
                  <h2 className="flex items-center gap-2 font-heading text-lg font-black text-slate-900">
                    <WalletCards className="size-5 text-violet-600" />
                    ประวัติแต้ม
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    เรียงจากรายการล่าสุด
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={resetLookup}>
                  ตรวจสอบเบอร์อื่น
                </Button>
              </div>

              {transactions.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-slate-500">
                  <Clock3 className="mx-auto mb-3 size-8 text-slate-300" />
                  ยังไม่มีประวัติการรับหรือใช้แต้ม
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {transactions.map((transaction, index) => {
                    const positive = transaction.points >= 0;
                    return (
                      <article
                        key={`${transaction.id}-${index}`}
                        className="flex items-start gap-3 px-4 py-4 sm:px-6"
                      >
                        <div
                          className={`mt-0.5 grid size-10 shrink-0 place-items-center rounded-2xl ${
                            positive
                              ? "bg-emerald-50 text-emerald-600"
                              : "bg-rose-50 text-rose-600"
                          }`}
                        >
                          {positive ? (
                            <ArrowUpRight className="size-5" />
                          ) : (
                            <ArrowDownRight className="size-5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-bold text-slate-900">
                                {transactionLabels[transaction.type]}
                              </h3>
                              <p className="mt-0.5 break-words text-xs leading-5 text-slate-500">
                                {transaction.note || "รายการแต้มสมาชิก"}
                              </p>
                            </div>
                            <div
                              className={`shrink-0 text-right text-base font-black tabular-nums ${
                                positive ? "text-emerald-600" : "text-rose-600"
                              }`}
                            >
                              {positive ? "+" : ""}
                              {transaction.points.toLocaleString("th-TH")}
                              <span className="ml-1 text-xs font-bold">แต้ม</span>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                            <span className="flex items-center gap-1">
                              <Clock3 className="size-3" />
                              {fmtDateTime(transaction.createdAt)}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="size-3" />
                              {transaction.branchName}
                            </span>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {lookup.hasNextPage && (
                <div className="border-t border-slate-100 p-4 text-center">
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    disabled={lookup.isFetchingNextPage}
                    onClick={() => void lookup.fetchNextPage()}
                  >
                    {lookup.isFetchingNextPage ? (
                      <LoaderCircle className="mr-2 size-4 animate-spin" />
                    ) : (
                      <History className="mr-2 size-4" />
                    )}
                    ดูรายการก่อนหน้า
                  </Button>
                </div>
              )}
            </section>
          </div>
        )}

        <footer className="mt-8 text-center text-xs leading-5 text-slate-500">
          หากยอดแต้มไม่ถูกต้อง กรุณาแสดงหน้านี้และติดต่อพนักงานหน้าร้าน
        </footer>
      </div>
    </main>
  );
}

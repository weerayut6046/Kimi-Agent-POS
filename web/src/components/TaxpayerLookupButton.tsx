import { useCallback, useEffect, useRef, useState } from "react";
import { Database, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";

export type TaxpayerLookupResult = {
  taxId: string;
  name: string;
  branchType: "hq" | "branch";
  branchNo: string;
  address: string;
  source: "rd-vat";
  verifiedAt: string;
};

type Props = {
  taxId: string;
  branchType: "hq" | "branch";
  branchNo: string;
  onFound: (result: TaxpayerLookupResult) => void;
};

export function TaxpayerLookupButton({
  taxId,
  branchType,
  branchNo,
  onFound,
}: Props) {
  const normalizedTaxId = taxId.replace(/\D/g, "").slice(0, 13);
  const normalizedBranch = branchNo.replace(/\D/g, "").slice(0, 5);
  const branchNumber =
    branchType === "branch" ? Number(normalizedBranch || -1) : 0;
  const canLookup =
    normalizedTaxId.length === 13 &&
    (branchType === "hq" || /^[0-9]{1,5}$/.test(normalizedBranch));
  const lookupKey = `${normalizedTaxId}:${branchNumber}`;
  const [feedback, setFeedback] = useState<{
    key: string;
    tone: "loading" | "success" | "error";
    message: string;
  } | null>(null);
  const utils = trpc.useUtils();
  const initialLookupKeyRef = useRef(lookupKey);
  const currentKeyRef = useRef(lookupKey);
  const lastAutomaticKeyRef = useRef("");
  const onFoundRef = useRef(onFound);

  useEffect(() => {
    currentKeyRef.current = lookupKey;
  }, [lookupKey]);

  useEffect(() => {
    onFoundRef.current = onFound;
  }, [onFound]);

  const runLookup = useCallback(async () => {
    if (!canLookup) return;
    const requestedKey = lookupKey;
    setFeedback({
      key: requestedKey,
      tone: "loading",
      message: "กำลังตรวจสอบกับกรมสรรพากร...",
    });
    try {
      const result = await utils.client.customers.lookupTaxpayer.query({
        taxId: normalizedTaxId,
        branchNumber,
      });
      if (currentKeyRef.current !== requestedKey) return;
      onFoundRef.current(result);
      setFeedback({
        key: requestedKey,
        tone: "success",
        message: "เติมข้อมูลอัตโนมัติจากทะเบียน VAT กรมสรรพากรแล้ว",
      });
    } catch (error) {
      if (currentKeyRef.current !== requestedKey) return;
      setFeedback({
        key: requestedKey,
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "ไม่สามารถตรวจสอบข้อมูลกับกรมสรรพากรได้ในขณะนี้",
      });
    }
  }, [branchNumber, canLookup, lookupKey, normalizedTaxId, utils.client]);

  useEffect(() => {
    const inputChangedSinceOpen = initialLookupKeyRef.current !== lookupKey;
    if (!canLookup || !inputChangedSinceOpen) {
      lastAutomaticKeyRef.current = "";
      return;
    }
    if (lastAutomaticKeyRef.current === lookupKey) return;

    const timer = window.setTimeout(() => {
      lastAutomaticKeyRef.current = lookupKey;
      void runLookup();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [canLookup, lookupKey, runLookup]);

  const isFetching = feedback?.key === lookupKey && feedback.tone === "loading";

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full justify-center border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:text-sky-900"
        disabled={!canLookup || isFetching}
        onClick={() => {
          lastAutomaticKeyRef.current = lookupKey;
          void runLookup();
        }}
      >
        {isFetching ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Database className="size-4" />
        )}
        {isFetching ? "กำลังดึงข้อมูลอัตโนมัติ..." : "ตรวจสอบใหม่กับกรมสรรพากร"}
      </Button>
      {!canLookup && (
        <p className="text-xs text-slate-500">
          ระบบจะดึงข้อมูลอัตโนมัติเมื่อกรอกเลขผู้เสียภาษีครบ 13 หลัก
          {branchType === "branch" ? " และระบุเลขสาขา" : ""}
        </p>
      )}
      {feedback?.key === lookupKey && feedback.tone !== "loading" && (
        <p
          className={
            feedback.tone === "success"
              ? "text-xs text-emerald-700"
              : "text-xs text-destructive"
          }
          role="status"
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}

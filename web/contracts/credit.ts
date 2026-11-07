import { bangkokDateKey } from "./promotion";

export const creditAccountStates = ["legacy", "approved", "suspended"] as const;
export type CreditAccountState = (typeof creditAccountStates)[number];
export type CreditStatus = CreditAccountState | "unapproved";

export const creditStatusLabel: Record<CreditStatus, string> = {
  unapproved: "รออนุมัติเครดิต",
  legacy: "เครดิตเดิม",
  approved: "อนุมัติแล้ว",
  suspended: "พักเครดิต",
};

export type CreditTerms = {
  buyerType: "individual" | "company";
  limit: number;
  days: number;
  agreementRef: string;
  signedOn: string;
  applicationRef: string;
  identityRef: string;
  receiversRef: string;
  privacyNoticeRef: string;
  authorityRef?: string;
};

export type CreditSaleProof = {
  agreementRef: string;
  deliveryRef: string;
};

export const creditFollowUpKinds = ["notice", "dispute", "legal_review"] as const;
export type CreditFollowUpKind = (typeof creditFollowUpKinds)[number];

export const creditEventKinds = [
  "approval",
  "suspension",
  ...creditFollowUpKinds,
  "sale_voided",
  "payment_reversed",
] as const;
export type CreditEventKind = (typeof creditEventKinds)[number];

export type CreditEventData = {
  terms?: CreditTerms;
  occurredOn?: string;
  reference?: string;
  notes?: string;
  reviewRoute?: "civil" | "suspected_fraud";
  payment?: {
    id: number;
    paymentNo: string;
    amount: number;
    method: string;
    receivedAt: string;
    staffName: string;
    saleId: number | null;
    requestId: string | null;
    note: string | null;
  };
};

export function creditDueOn(soldAt: Date, days: number): string {
  const due = new Date(`${bangkokDateKey(soldAt)}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + days);
  return due.toISOString().slice(0, 10);
}

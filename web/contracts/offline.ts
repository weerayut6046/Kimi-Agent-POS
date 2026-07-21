export type SalePaymentMethod = "cash" | "qr" | "card" | "credit";

export type DesktopSaleInput = {
  shiftId?: number;
  staffName: string;
  memberId?: number;
  customerId?: number;
  items: Array<{ productId: number; qty: number }>;
  discount: number;
  paymentMethod: SalePaymentMethod;
  received: number;
  pointsToRedeem: number;
};

export type DesktopSaleLine = {
  productId: number;
  name: string;
  unit: string;
  unitPrice: number;
  category: "fuel" | "lubricant" | "other";
  qty: number;
};

export type DesktopSaleContext = {
  vatRate: number;
  pointEarnPerBaht: number;
  pointRedeemValue: number;
  memberName: string | null;
  customerName: string | null;
};

export type DesktopSaleRequest = {
  input: DesktopSaleInput;
  lines: DesktopSaleLine[];
  context: DesktopSaleContext;
  staffToken?: string;
};

export type DesktopReceipt = {
  sale: {
    id: number;
    receiptNo: string;
    createdAt: Date;
    subtotal: number;
    discount: number;
    vatRate: number;
    vatAmount: number;
    total: number;
    paymentMethod: SalePaymentMethod;
    received: number;
    changeAmt: number;
    pointsEarned: number;
    pointsRedeemed: number;
    memberName: string | null;
    customerName: string | null;
  };
  items: Array<{
    name: string;
    qty: number;
    unit: string;
    unitPrice: number;
    amount: number;
  }>;
};

export type DesktopSaleResult = DesktopReceipt & {
  mode: "online" | "queued";
  pendingCount: number;
};

export type DesktopSyncStatus = {
  desktop: true;
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
};

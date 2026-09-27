import { saleItems } from "@db/schema";

/**
 * รายการขายสำหรับใบเสร็จ/หน้าประวัติที่พนักงานขายเข้าถึงได้
 * จงใจไม่รวม costPerUnit ซึ่งเป็นข้อมูลเฉพาะผู้ดูแลและผู้จัดการ
 */
export const receiptSaleItemSelection = {
  id: saleItems.id,
  branchId: saleItems.branchId,
  saleId: saleItems.saleId,
  originalSaleItemId: saleItems.originalSaleItemId,
  productId: saleItems.productId,
  name: saleItems.name,
  qty: saleItems.qty,
  unit: saleItems.unit,
  unitPrice: saleItems.unitPrice,
  productCategory: saleItems.productCategory,
  amount: saleItems.amount,
};

// Cửa hàng Nguyên Tệ — luật thuần. Chỉ có hai đường tiêu: đổi phần thưởng thật và mua thẻ miễn phạt.

export type PurchaseRefusal = "invalid_price" | "insufficient_balance";

/** Chỉ mua khi số dư ≥ giá: đang nợ thì không mua được gì, và mua xong không bao giờ âm. */
export function purchaseRefusal(balance: number, price: number): PurchaseRefusal | null {
  if (!Number.isFinite(price) || price <= 0) return "invalid_price";
  if (!Number.isFinite(balance) || balance < price) return "insufficient_balance";
  return null;
}

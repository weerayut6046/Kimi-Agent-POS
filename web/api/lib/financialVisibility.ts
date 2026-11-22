/** Keep the existing operational response shape without exposing stored cost. */
export function redactProductCost<T extends { cost: number }>(
  product: T,
  canReadCost: boolean
): T;
export function redactProductCost<T extends { cost: number }>(
  product: T | null,
  canReadCost: boolean
): T | null;
export function redactProductCost<T extends { cost: number }>(
  product: T | null,
  canReadCost: boolean
): T | null {
  if (!product || canReadCost) return product;
  return { ...product, cost: 0 };
}

const CUSTOMER_POINTS_PROCEDURE = "membership.customerPoints";
const FUNCTION_PATH_MARKER = "/pos-loyalty/";

/** จำกัด public Edge Function ให้เรียกได้เฉพาะ procedure เช็กแต้มลูกค้า */
export function isCustomerPointsRequestPath(pathname: string): boolean {
  const markerIndex = pathname.indexOf(FUNCTION_PATH_MARKER);
  if (markerIndex < 0) return false;
  const encodedProcedures = pathname.slice(
    markerIndex + FUNCTION_PATH_MARKER.length
  );
  if (!encodedProcedures) return false;
  let procedures: string;
  try {
    procedures = decodeURIComponent(encodedProcedures);
  } catch {
    return false;
  }
  return procedures
    .split(",")
    .every(procedure => procedure === CUSTOMER_POINTS_PROCEDURE);
}

/** คืน prefix ที่ tRPC ต้องตัดออก ทั้งตอน serve local และบน Edge Production */
export function resolveLoyaltyEndpoint(pathname: string): string {
  const markerIndex = pathname.indexOf(FUNCTION_PATH_MARKER);
  if (markerIndex < 0) return "";
  return pathname.slice(0, markerIndex + FUNCTION_PATH_MARKER.length - 1);
}

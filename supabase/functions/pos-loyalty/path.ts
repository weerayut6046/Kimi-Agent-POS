const CUSTOMER_POINTS_PROCEDURE = "membership.customerPoints";

/** จำกัด public Edge Function ให้เรียกได้เฉพาะ procedure เช็กแต้มลูกค้า */
export function isCustomerPointsRequestPath(pathname: string): boolean {
  const marker = "/pos-loyalty/";
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex < 0) return false;
  const encodedProcedures = pathname.slice(markerIndex + marker.length);
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

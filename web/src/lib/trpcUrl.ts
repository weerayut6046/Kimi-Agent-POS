type TrpcUrlOptions = {
  isDesktop: boolean;
  isDev: boolean;
  supabaseUrl: string;
};

type TrpcGatewayOptions = TrpcUrlOptions & {
  proxyToSupabaseInDev: boolean;
};

type TrpcAuthHeaderOptions = {
  accessToken: string | null;
  publishableKey: string;
  usesSupabaseGateway: boolean;
};

/**
 * The packaged desktop app is served from a random loopback port by its
 * offline runtime. Keep API calls same-origin there so the runtime can proxy
 * and cache them without requiring an unsafe wildcard CORS policy.
 */
export function resolveTrpcUrl({
  isDesktop,
  isDev,
  supabaseUrl,
}: TrpcUrlOptions): string {
  if (isDesktop || isDev || !supabaseUrl) return "/api/trpc";
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/pos-api`;
}

export function usesSupabaseEdgeGateway({
  isDesktop,
  isDev,
  supabaseUrl,
  proxyToSupabaseInDev,
}: TrpcGatewayOptions): boolean {
  return !isDesktop && Boolean(supabaseUrl) && (!isDev || proxyToSupabaseInDev);
}

export function trpcAuthHeaders({
  accessToken,
  publishableKey,
  usesSupabaseGateway,
}: TrpcAuthHeaderOptions): Record<string, string> {
  const token = accessToken?.trim();
  const key = publishableKey.trim();
  return {
    ...(usesSupabaseGateway && key ? { apikey: key } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

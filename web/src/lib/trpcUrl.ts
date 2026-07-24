type TrpcUrlOptions = {
  isDesktop: boolean;
  isDev: boolean;
  supabaseUrl: string;
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

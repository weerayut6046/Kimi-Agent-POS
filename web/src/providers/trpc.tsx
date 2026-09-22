import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";
import { queryRetryDelay, shouldRetryQuery } from "@/lib/queryRetry";
import { currentFaceSessionProof, currentSupabaseAccessToken } from "@/lib/supabase";
import { isLocalAuthEnabled, readLocalSessionToken } from "@/lib/localAuth";
import {
  resolveTrpcUrl,
  trpcAuthHeaders,
  usesSupabaseEdgeGateway,
} from "@/lib/trpcUrl";

export const trpc = createTRPCReact<AppRouter>();
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
const supabaseFunctionRegion =
  import.meta.env.VITE_SUPABASE_FUNCTION_REGION?.trim() || "ap-northeast-1";
const isDesktopRuntime =
  typeof window !== "undefined" && Boolean(window.posDesktop);
const proxyToSupabaseInDev =
  import.meta.env.VITE_USE_SUPABASE_EDGE_API?.trim().toLowerCase() === "true";
const trpcUrl = resolveTrpcUrl({
  isDesktop: isDesktopRuntime,
  isDev: import.meta.env.DEV,
  supabaseUrl,
});
const usesSupabaseGateway = usesSupabaseEdgeGateway({
  isDesktop: isDesktopRuntime,
  isDev: import.meta.env.DEV,
  supabaseUrl,
  proxyToSupabaseInDev,
});
const customerLoyaltyTrpcUrl =
  typeof window !== "undefined" &&
  !window.posDesktop &&
  !import.meta.env.DEV &&
  supabaseUrl
    ? `${supabaseUrl}/functions/v1/pos-loyalty`
    : trpcUrl;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
      // Reuse recent server state while moving between screens. Realtime and
      // mutation invalidations still refresh affected data immediately.
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

async function requestHeaders() {
  const token = isLocalAuthEnabled
    ? readLocalSessionToken()
    : await currentSupabaseAccessToken();
  const faceProof = isLocalAuthEnabled ? null : currentFaceSessionProof();
  const branchId = localStorage.getItem("pumppos_branch_id");
  return {
    ...(isLocalAuthEnabled && token
      ? { "x-staff-session": token }
      : trpcAuthHeaders({
          accessToken: token,
          publishableKey: supabasePublishableKey,
          usesSupabaseGateway,
        })),
    "x-region": supabaseFunctionRegion,
    ...(!isLocalAuthEnabled && token && faceProof
      ? { "x-face-proof": faceProof }
      : {}),
    ...(branchId && /^[1-9][0-9]*$/.test(branchId)
      ? { "x-branch-id": branchId }
      : {}),
  };
}

function trpcFetch(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(input, {
    ...(init ?? {}),
    // Supabase Auth uses the explicit Bearer token above, not cookies.
    // Omitting credentials keeps cross-origin CORS simple and strict.
    credentials: "omit",
  });
}

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: operation => operation.path === "membership.customerPoints",
      true: httpBatchLink({
        url: customerLoyaltyTrpcUrl,
        transformer: superjson,
        maxURLLength: 2_048,
        headers: requestHeaders,
        fetch: trpcFetch,
      }),
      false: splitLink({
        condition: operation => operation.context.skipBatch === true,
        true: httpLink({
          url: trpcUrl,
          transformer: superjson,
          headers: requestHeaders,
          fetch: trpcFetch,
        }),
        false: httpBatchLink({
          // Web production calls Supabase directly. Desktop stays same-origin so
          // its local offline runtime can proxy/cache requests without CORS.
          url: trpcUrl,
          transformer: superjson,
          maxURLLength: 2_048,
          headers: requestHeaders,
          fetch: trpcFetch,
        }),
      }),
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}

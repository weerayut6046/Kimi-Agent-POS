import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";
import { queryRetryDelay, shouldRetryQuery } from "@/lib/queryRetry";
import { currentSupabaseAccessToken } from "@/lib/supabase";
import { resolveTrpcUrl } from "@/lib/trpcUrl";

export const trpc = createTRPCReact<AppRouter>();
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
const supabaseFunctionRegion =
  import.meta.env.VITE_SUPABASE_FUNCTION_REGION?.trim() || "ap-northeast-1";
const trpcUrl = resolveTrpcUrl({
  isDesktop: typeof window !== "undefined" && Boolean(window.posDesktop),
  isDev: import.meta.env.DEV,
  supabaseUrl,
});

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
  const token = await currentSupabaseAccessToken();
  const branchId = localStorage.getItem("pumppos_branch_id");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "x-region": supabaseFunctionRegion,
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
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}

import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { isRealtimeInvalidationEvent } from "@contracts/realtime";
import { useStaff } from "./useStaff";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { isLocalAuthEnabled, readLocalSessionToken } from "@/lib/localAuth";
import { createSseParser } from "@/lib/realtimeSse";
import { trpc } from "@/providers/trpc";
import {
  createRealtimeRefreshScheduler,
  realtimeHttpRetryDelayMs,
  shouldRefreshAfterTransportReady,
} from "@/lib/realtimeRefresh";

const SUPABASE_TOPIC_PREFIX = "pos-invalidation-v1";
const SUPABASE_EVENT = "invalidate";

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { staff } = useStaff();
  const queryClient = useQueryClient();
  const staffId = staff?.id;
  const branchId = staff?.branch.id;
  const deployment = trpc.auth.deploymentInfo.useQuery(undefined, {
    enabled: Boolean(staffId),
    staleTime: 60_000,
    trpc: { context: { skipBatch: true } },
  });
  const businessRealtimeEnabled = deployment.data?.mode === "business";

  useEffect(() => {
    if (!staffId || !branchId || !businessRealtimeEnabled) return;

    let stopped = false;
    let client: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;
    let retryTimer: number | undefined;
    let retryMs = 1_000;
    let unsubscribeAuth: (() => void) | undefined;
    let lastTransportRefreshAt = Number.NEGATIVE_INFINITY;
    const seen = new Set<string>();
    const refresh = createRealtimeRefreshScheduler(() => {
      void queryClient.invalidateQueries(
        { refetchType: "active" },
        { cancelRefetch: false }
      );
    });
    const refreshAfterTransportReady = () => {
      const now = Date.now();
      if (!shouldRefreshAfterTransportReady(lastTransportRefreshAt, now)) {
        return;
      }
      lastTransportRefreshAt = now;
      refresh.schedule();
    };

    const invalidate = (event: unknown) => {
      if (!isRealtimeInvalidationEvent(event)) return;
      if (event.branchId !== branchId || seen.has(event.eventId)) return;
      seen.add(event.eventId);
      if (seen.size > 256) {
        const oldest = seen.values().next().value as string | undefined;
        if (oldest) seen.delete(oldest);
      }
      refresh.schedule();
    };

    if (isLocalAuthEnabled) {
      let stopped = false;
      let retryTimer: number | undefined;
      let retryMs = 1_000;
      let activeController: AbortController | undefined;

      const scheduleRetry = (delayMs?: number) => {
        if (stopped || retryTimer !== undefined) return;
        const nextDelayMs = delayMs ?? retryMs;
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          void connect();
        }, nextDelayMs);
        if (delayMs === undefined) {
          retryMs = Math.min(retryMs * 2, 30_000);
        }
      };

      const connect = async () => {
        const token = readLocalSessionToken();
        if (stopped || !token) return;
        const controller = new AbortController();
        activeController = controller;
        let retryDelay: number | null | undefined;
        try {
          const response = await fetch("/api/realtime", {
            headers: {
              "x-staff-session": token,
              "x-branch-id": String(branchId),
            },
            credentials: "omit",
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            const serverRetryDelay = realtimeHttpRetryDelayMs(
              response.status,
              response.headers.get("retry-after"),
              retryMs
            );
            if (serverRetryDelay === null) {
              retryDelay = null;
              return;
            }
            if (response.status === 429 || response.status === 503) {
              retryDelay = serverRetryDelay;
            }
            throw new Error(`Realtime HTTP ${response.status}`);
          }
          retryMs = 1_000;
          const decoder = new TextDecoder();
          const parse = createSseParser(message => {
            if (message.event === "ready") {
              refreshAfterTransportReady();
              return;
            }
            if (message.event !== "invalidate") return;
            try {
              invalidate(JSON.parse(message.data));
            } catch {
              // Ignore malformed frames; the next valid event still works.
            }
          });
          const reader = response.body.getReader();
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            parse(decoder.decode(value, { stream: true }));
          }
        } catch (error) {
          if (
            stopped ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            return;
          // Network and server failures reconnect in finally using backoff.
        } finally {
          if (activeController === controller) activeController = undefined;
          if (!stopped && retryDelay !== null) scheduleRetry(retryDelay);
        }
      };

      void connect();
      return () => {
        stopped = true;
        refresh.cancel();
        activeController?.abort();
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      };
    }

    const disconnect = () => {
      const previous = channel;
      channel = null;
      if (previous && client) void client.removeChannel(previous);
    };

    const scheduleRetry = () => {
      if (stopped || retryTimer !== undefined) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    };

    const connect = async () => {
      if (stopped || !client || channel) return;
      const { data } = await client.auth.getSession();
      if (!data.session) return;
      await client.realtime.setAuth(data.session.access_token);
      if (stopped || channel) return;

      const next = client
        .channel(`${SUPABASE_TOPIC_PREFIX}:${branchId}`, {
          config: { private: true },
        })
        .on("broadcast", { event: SUPABASE_EVENT }, message =>
          invalidate(message.payload)
        );
      channel = next;
      next.subscribe(status => {
        if (stopped || channel !== next) return;
        if (status === "SUBSCRIBED") {
          retryMs = 1_000;
          refreshAfterTransportReady();
          return;
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          disconnect();
          scheduleRetry();
        }
      });
    };

    void getSupabaseBrowserClient().then(nextClient => {
      if (!nextClient || stopped) return;
      client = nextClient;
      void connect();
      const auth = nextClient.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => {
          if (stopped) return;
          disconnect();
          if (session) void connect();
        }, 0);
      });
      unsubscribeAuth = () => auth.data.subscription.unsubscribe();
    });

    return () => {
      stopped = true;
      refresh.cancel();
      unsubscribeAuth?.();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      disconnect();
    };
  }, [branchId, businessRealtimeEnabled, queryClient, staffId]);

  return children;
}

import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { isRealtimeInvalidationEvent } from "@contracts/realtime";
import { useStaff } from "./useStaff";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const SUPABASE_TOPIC_PREFIX = "pos-invalidation-v1";
const SUPABASE_EVENT = "invalidate";

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { staff } = useStaff();
  const queryClient = useQueryClient();
  const staffId = staff?.id;
  const branchId = staff?.branch.id;

  useEffect(() => {
    if (!staffId || !branchId) return;

    let stopped = false;
    let client: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;
    let retryTimer: number | undefined;
    let retryMs = 1_000;
    let unsubscribeAuth: (() => void) | undefined;
    const seen = new Set<string>();

    const invalidate = (event: unknown) => {
      if (!isRealtimeInvalidationEvent(event)) return;
      if (event.branchId !== branchId || seen.has(event.eventId)) return;
      seen.add(event.eventId);
      if (seen.size > 256) {
        const oldest = seen.values().next().value as string | undefined;
        if (oldest) seen.delete(oldest);
      }
      void queryClient.invalidateQueries(
        { refetchType: "active" },
        { cancelRefetch: false },
      );
    };

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
          invalidate(message.payload),
        );
      channel = next;
      next.subscribe(status => {
        if (stopped || channel !== next) return;
        if (status === "SUBSCRIBED") {
          retryMs = 1_000;
          void queryClient.invalidateQueries(
            { refetchType: "active" },
            { cancelRefetch: false },
          );
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
      unsubscribeAuth?.();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      disconnect();
    };
  }, [branchId, queryClient, staffId]);

  return children;
}

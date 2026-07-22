export const REALTIME_EVENT_VERSION = 1 as const;

/**
 * Realtime messages are deliberately opaque. They tell an authenticated
 * client to refresh data through the normal API and never contain row data,
 * customer details, staff details, totals, or database identifiers.
 */
export type RealtimeInvalidationEvent = {
  version: typeof REALTIME_EVENT_VERSION;
  eventId: string;
  scope: "all";
};

export function isRealtimeInvalidationEvent(
  value: unknown
): value is RealtimeInvalidationEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    event.version === REALTIME_EVENT_VERSION &&
    typeof event.eventId === "string" &&
    event.eventId.length >= 16 &&
    event.eventId.length <= 128 &&
    event.scope === "all" &&
    Object.keys(event).every(key =>
      ["version", "eventId", "scope"].includes(key)
    )
  );
}

/**
 * Event names for the chat offline outbox (`spec/behavior/observability.md`
 * § Outbox Telemetry). One canonical source rather than literal strings at
 * each `ctx.track()` call site in `chat-client.ts`, so a typo can't quietly
 * split one event into two names.
 *
 * Kebab-case to match the existing client-event convention (`opened-channel`,
 * `ran-slash-command`, the `activation-*` funnel names in
 * `packages/validation/src/analytics.ts`).
 *
 * Every property passed alongside these events must be behavioral, never
 * content — `ctx.track` ultimately posts through `POST /v1/analytics/events`,
 * which rejects forbidden keys and non-scalar values via
 * `assertContentFreeProperties` (`@repo/validation`). In particular, never
 * pass an `OutboxRow`'s `body` field or anything derived from message
 * content.
 */
export const OUTBOX_ANALYTICS_EVENTS = {
  /** A message was written to the outbox — the first send attempt, or a retry. */
  queued: "outbox-queued",
  /** The server accepted the message and it left the outbox. */
  confirmed: "outbox-confirmed",
  /** A 4xx response — terminal, the row moves to `failed` and stays for a manual retry/discard. */
  failedTerminal: "outbox-failed-4xx",
  /** A network error or 5xx — transient, the row stays `queued` for the next reconnect flush. */
  failedTransient: "outbox-failed-network",
  /** A member tapped Retry on a failed row. */
  retried: "outbox-retried",
  /** A member discarded a failed row instead of retrying it. */
  discarded: "outbox-discarded",
} as const;

export type OutboxAnalyticsEvent =
  (typeof OUTBOX_ANALYTICS_EVENTS)[keyof typeof OUTBOX_ANALYTICS_EVENTS];

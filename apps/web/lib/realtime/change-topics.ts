/**
 * The database → client change-ping contract.
 *
 * These strings are one half of a cross-substrate contract. The other half is
 * the trigger functions and the `realtime_messages_scoped_select` policy in
 * `supabase/migrations/20260816140000_realtime_carrier_repair.sql`, which build
 * the same topics in SQL and authorise them per subscriber.
 *
 * A change on one side that is not mirrored on the other fails **silently in
 * the worst direction**: the channel still joins and still reports `SUBSCRIBED`,
 * it just never receives anything — which is indistinguishable from "nothing has
 * changed yet". That is precisely the failure mode #867 spent two days
 * diagnosing, so `change-topics.test.ts` pins every string here verbatim. Treat a
 * failure of that test as "update the migration too", never as "update the
 * expectation".
 *
 * Kept deliberately tiny and dependency-free so both the hook and the pin test
 * can import it without pulling in React or the Supabase client.
 */

/** The `event` name every change ping is sent under (`realtime.send(..., 'change', ...)`). */
export const CHANGE_EVENT = "change";

/**
 * Tables that emit a change ping, mapped to the topic that carries it.
 *
 * The scope id differs per table and mirrors the column each subscription used
 * to filter on before the carrier moved to broadcast:
 *   notifications    → `users.id`   (NOT `supabase_auth_id`)
 *   events           → `chapters.id`
 *   event_attendance → `events.id`
 */
export const CHANGE_TOPIC_BUILDERS = {
  notifications: (scopeId: string) => `notif:${scopeId}`,
  events: (scopeId: string) => `events:${scopeId}`,
  event_attendance: (scopeId: string) => `attendance:${scopeId}`,
} as const;

export type ChangeTable = keyof typeof CHANGE_TOPIC_BUILDERS;

/** Builds the private broadcast topic carrying `table`'s changes for `scopeId`. */
export function changeTopic(table: ChangeTable, scopeId: string): string {
  return CHANGE_TOPIC_BUILDERS[table](scopeId);
}

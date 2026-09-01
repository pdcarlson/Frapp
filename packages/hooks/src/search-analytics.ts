/**
 * Event name for global-search telemetry (`spec/behavior/observability.md`
 * § Search Telemetry). One canonical source, matching the pattern in
 * `packages/chat-core/src/outbox-analytics.ts` — a literal string at each
 * `ctx.track()`/`track()` call site risks a typo quietly splitting one event
 * into two names.
 *
 * Kebab-case to match the existing client-event convention (`opened-channel`,
 * the `activation-*` funnel names in `packages/validation/src/analytics.ts`).
 *
 * Every property passed alongside this event must be behavioral, never
 * content — the raw query string is never sent. `assertContentFreeProperties`
 * (`@repo/validation`) does not forbid a key literally named `query`, so this
 * is a design discipline, not something the shared gate would catch: send
 * `query_length`/`query_word_count` instead of the query text itself.
 */
export const SEARCH_COMPLETED_EVENT = "search-completed";

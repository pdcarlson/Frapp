import { formatRelativeDayTime, parseInstant } from "@repo/formatting";

const CLEAR = "Nothing on your plate.";

/**
 * The one line a member with no tasks sees in place of the board: that the
 * plate is clear, then the chapter's next event, so the line says what comes
 * next and not only what isn't there. "Next up" is the soonest event that
 * hasn't started. With none ahead, or with Events off (`events` undefined),
 * the line stops at the first sentence.
 */
export function nextUpLine(events: unknown, now: number): string {
  if (!Array.isArray(events)) return CLEAR;
  let next: { name: string; at: Date; start: unknown } | null = null;
  for (const event of events as Record<string, unknown>[]) {
    const at = parseInstant(event?.start_time);
    if (!at || at.getTime() < now) continue;
    const name = typeof event.name === "string" ? event.name.trim() : "";
    if (!name) continue;
    if (!next || at.getTime() < next.at.getTime()) {
      next = { name, at, start: event.start_time };
    }
  }
  if (!next) return CLEAR;
  const when = formatRelativeDayTime(next.start, new Date(now));
  return `${CLEAR} Next up: ${next.name}${when ? `, ${when}` : ""}.`;
}

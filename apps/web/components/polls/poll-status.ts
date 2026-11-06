import type { BadgeKind } from "@/components/ui/badge";
import { formatDay, formatDayTime } from "@repo/formatting";

/**
 * Poll open/closed state → the §5 badge kind that states it, and the label.
 *
 * `polls-page.tsx` rendered this as `isExpired ? "outline" : "default"`, and
 * `default` is §5's Accent kind — the chapter's own colour on a domain status.
 * That is #1202's defect reached by an inline ternary, and this family had no
 * mapper at all, so `components/shared/status-kind.spec.ts` never looked at it.
 * The measurement is in `components/billing/status-contrast.spec.ts`: under a
 * green seed an accent badge sits 1.08:1 from the success badge and under
 * `#CC0000`/`#8B0000`/`#BF0A30` 1.13:1 from danger, so the chapter that most
 * needs "Open" to read as open is the one where it read as a failure.
 *
 * The mirror error shipped with it: `outline` is §5's Hairline, "quiet
 * metadata that must not read as a status", and it was carrying `Closed`.
 *
 * Open is foundations §5's success — the poll accepts votes. Closed keeps the
 * Hairline kind and deliberately does not become a semantic hue, for the same
 * reason `geofence-status.ts` gives a disabled zone and `invoice-status.ts`
 * gives `DRAFT`: a poll that reached its deadline is the *absence* of an open
 * poll, not a failure, and painting an expected end-of-life in danger red is
 * the decorative use of a semantic hue §5 forbids.
 *
 * **Why a boolean rather than a status token.** `writing.md` §5 lists `OPEN` in
 * the vocabulary it governs — but the server sends no token here. The
 * poll DTO carries `isExpired: boolean`, which the API derives from either
 * `expires_at` passing *or* the creator manually closing the poll early
 * (`PollService.isPollExpired`, #379 — the API's `isPollClosed`
 * only covers the deadline half; the manual-close half is server-side only),
 * and `spec/behavior/polls.md` describes the state as a lock rather than a
 * field. So this is §5's other branch, "a
 * vocabulary with no row here maps to plain language *once*, in its mapper" —
 * which is why the label lives beside the kind instead of at the call site.
 * `geofence-status.ts` has the same boolean-derived shape.
 */
export function pollStatusKind(isOpen: boolean): BadgeKind {
  return isOpen ? "success" : "outline";
}

export function pollStatusLabel(isOpen: boolean): string {
  return isOpen ? "Open" : "Closed";
}

/**
 * A poll tile's one meta line: channel, choice mode, and the deadline, as
 * "#general · Single choice · Closes Sun, Nov 8 · 4:30 AM" or
 * "#general · Multi-choice · Closed Nov 8".
 *
 * No "Created" clause: when a poll was posted is the chat's business, and on
 * this list it pushed the one date a voter needs (when it closes) to the end
 * of a two-timestamp line. An absent fact drops out rather than printing a
 * placeholder (`spec/ui/web-dashboard/README.md` § Page grammar), so a poll in
 * a channel this member cannot see has no channel clause, and an open poll with
 * no deadline has no deadline clause.
 *
 * A manually closed poll (#379) shows its own `closed_at`, not `expires_at`:
 * a poll closed early can have a still-future (or absent) `expires_at`, and
 * showing that date next to "Closed" would tell a member the poll closed on a
 * day that hasn't happened yet. A closed poll takes the day alone; an open one
 * keeps the time, because "closes at 4:30" is what a voter acts on.
 */
export function pollMetaLine(
  {
    channelName,
    isMultiChoice,
    isExpired,
    expiresAt,
    closedAt,
  }: {
    channelName: string | null;
    isMultiChoice: boolean;
    isExpired: boolean;
    expiresAt?: string | null;
    closedAt?: string | null;
  },
  now: Date = new Date(),
): string {
  let deadline: string | null = null;
  if (closedAt) {
    const day = formatDay(closedAt, now);
    deadline = day ? `Closed ${day}` : null;
  } else if (expiresAt) {
    if (isExpired) {
      const day = formatDay(expiresAt, now);
      deadline = day ? `Closed ${day}` : null;
    } else {
      const at = formatDayTime(expiresAt, now);
      deadline = at ? `Closes ${at}` : null;
    }
  }
  return [
    channelName ? `#${channelName}` : null,
    isMultiChoice ? "Multi-choice" : "Single choice",
    deadline,
  ]
    .filter(Boolean)
    .join(" · ");
}

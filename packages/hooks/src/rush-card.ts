import { serverMessageOf, statusOf } from "@repo/api-sdk";
import {
  moduleRefusalFromServerMessage,
  subscriptionRefusalFromServerMessage,
} from "@repo/validation";

/**
 * The rules a chat rush card applies, shared by web's
 * (`apps/web/components/chat/renderers/rush-card.tsx`) and mobile's
 * (`apps/mobile/components/chat/rush-card.tsx`), as `./task-card` is for the
 * task card. Pure, so both renderers' specs can drive them.
 *
 * The card's message is a creation-time snapshot: its bid is `"none"` and it
 * has no votes at all. So the badge, the tally and the controls come from the
 * live candidate or not at all. Drawing the snapshot would call a candidate
 * with a bid "Open" and one with ten votes "0 votes", and offer Extend bid on
 * a bid already extended.
 */

/** The candidate as `GET /v1/rush/candidates/{id}` returns it, as much as a card reads. */
export interface LiveRushCandidate {
  id: string;
  display_name: string;
  vote_count: number;
  viewer_has_voted: boolean;
  bid_extended: boolean;
}

/**
 * `useRushCandidate`'s data as a `LiveRushCandidate`, or `null` when there is
 * none yet (loading, a 403 or 404, a candidate since deleted, or a shape
 * without an id or a finite count).
 */
export function readLiveRushCandidate(data: unknown): LiveRushCandidate | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.display_name !== "string" ||
    typeof r.vote_count !== "number" ||
    !Number.isFinite(r.vote_count)
  ) {
    return null;
  }
  return {
    id: r.id,
    display_name: r.display_name,
    vote_count: r.vote_count,
    viewer_has_voted: r.viewer_has_voted === true,
    bid_extended: r.bid_status === "extended",
  };
}

/**
 * Whether the viewer may read the card's candidate. The rush routes need
 * `members:view` and nothing else (there are no rush permissions), so a card
 * shouldn't ask for anyone without it: for them it is a guaranteed 403, and
 * the card shows no tally. The reads also answer while Recruitment is off;
 * only the writes are refused then.
 */
export function canReadCardRushCandidate(input: {
  canViewMembers: boolean;
}): boolean {
  return input.canViewMembers;
}

/**
 * One control on a rush card, in the order the card draws them. `voted` is a
 * disabled indicator, not an action: there is no unvote, and a repeat vote
 * changes nothing.
 */
export type RushCardControl = "vote" | "voted" | "bid";

/**
 * The controls a rush card offers.
 *
 * - **Nothing until the live candidate is read.** Before it, the card can't
 *   know whether this viewer has voted or the bid is out.
 * - **Nothing while Recruitment is known to be off.** The server refuses both
 *   writes then, and a timeline of cards each saying so would be noise. The
 *   tally stays: the reads still answer.
 * - **Vote, or Voted** once the viewer has, for every member.
 * - **Extend bid** until a bid is out, for every member: the bid route has no
 *   permission of its own. Once it is out the badge says so and the control
 *   goes, since a repeat bid changes nothing.
 */
export function rushCardControls(input: {
  live: LiveRushCandidate | null;
  recruitmentOff: boolean;
}): RushCardControl[] {
  const { live, recruitmentOff } = input;
  if (!live || recruitmentOff) return [];
  const controls: RushCardControl[] = [
    live.viewer_has_voted ? "voted" : "vote",
  ];
  if (!live.bid_extended) controls.push("bid");
  return controls;
}

/** What a rush card's badge says: whether a bid is out. */
export function rushCardBadgeLabel(live: LiveRushCandidate): string {
  return live.bid_extended ? "Bid extended" : "Open";
}

/** The tally line: "1 vote", "3 votes · you voted". Voter names never. */
export function rushCardTally(live: LiveRushCandidate): string {
  const count = live.vote_count === 1 ? "1 vote" : `${live.vote_count} votes`;
  return live.viewer_has_voted ? `${count} · you voted` : count;
}

/** The tally's place when the candidate read failed for a reason other than a 403 or 404. */
export const RUSH_CARD_TALLY_ERROR = "Couldn't load votes";

/**
 * A gate's refusal of a vote or a bid, in a member's words. The module guard's
 * own message is addressed to the officer who can turn Recruitment back on
 * ("Re-enable it in Settings → Modules"), and the subscription guard's may
 * name checkout, so neither is shown as-is. Each names the module as Settings
 * → Modules labels it ("Recruitment", whatever the chapter calls it), because
 * that is the switch the officer turns back on. No plan, price or purchase
 * path: mobile's store answers say the app offers none
 * (`apps/mobile/lib/subscription-refusal.ts`).
 */
export const RUSH_CARD_REFUSAL_COPY = {
  subscription:
    "Your chapter's subscription isn't active, so votes and bids can't be saved. An officer can sort this out for the chapter.",
  recruitmentOff:
    "Recruitment is turned off for your chapter right now, so votes and bids can't be saved. An officer can turn recruitment back on.",
} as const;

/**
 * `RUSH_CARD_REFUSAL_COPY` for a gate's refusal, or `null` for any other
 * failure, which the card relays as the server words it. A 403 alone is not a
 * gate: the routes also 403 a missing `members:view` and the
 * `chapter.context.*` family, which recover by themselves.
 */
export function rushCardGateRefusal(error: unknown): string | null {
  if (statusOf(error) !== 403) return null;
  const message = serverMessageOf(error);
  if (subscriptionRefusalFromServerMessage(message)) {
    return RUSH_CARD_REFUSAL_COPY.subscription;
  }
  if (moduleRefusalFromServerMessage(message)?.moduleKey === "rush") {
    return RUSH_CARD_REFUSAL_COPY.recruitmentOff;
  }
  return null;
}

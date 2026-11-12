import { parseInstant } from "@repo/formatting";
import { moduleRefusalFromServerMessage } from "@repo/validation";
import { canActOnMessage, isOwnMessage } from "./message-actions";
import type { ChatMessage } from "./types";
import {
  POLL_VOTE_ACTION_TYPE,
  type PollOption,
  type PollPayload,
} from "./integrations/payloads";

/**
 * Poll payload parsing and vote-tally logic, shared by web's
 * `apps/web/components/chat/renderers/poll-card.tsx` and mobile's
 * `apps/mobile/components/chat/poll-card.tsx` (#528) so a future fix to
 * either only has one place to land.
 *
 * `PollOption`/`PollPayload`/`POLL_VOTE_ACTION_TYPE` are re-exported from
 * their canonical definitions in `./integrations/payloads`, so mobile's poll
 * card can keep importing everything poll-shaped from this one subpath.
 */

export { POLL_VOTE_ACTION_TYPE, type PollOption, type PollPayload };

/**
 * Member copy for the Polls module refusal: `spec/ui/design-system/writing.md`
 * § Module off, "Poll (chat card, web and mobile)".
 */
export const POLLS_OFF_COPY =
  "Polls are turned off for your chapter right now. An officer can turn them back on.";

/**
 * The Polls gate as a poll card's Vote reads it (#3012): the member view's
 * `enabled_modules.polls`, or why that isn't known yet. Each client derives it
 * from its own chapter read.
 */
export type PollsGate = "on" | "off" | "loading" | "error";

/**
 * Where a client's chapter read stands, in TanStack Query's terms: whether
 * the cached member view has Polls on (`undefined` while nothing is cached;
 * a missing `polls` key is on, so callers pass `isModuleEnabled(...)`), and
 * the read's `fetchStatus`.
 */
export interface PollsGateRead {
  pollsEnabled: boolean | undefined;
  fetchStatus: "fetching" | "paused" | "idle";
}

/**
 * The Polls gate from a chapter read, the same on web and mobile. A cached
 * answer wins, even over a failed refetch. With nothing cached, only a read
 * that is actually running is "loading"; a failed, paused (offline) or
 * disabled one is "error", because nothing is checking and a Retry is the only
 * way forward. It fails closed rather than open: design-system README §4,
 * "Idle with nothing cached still fails closed".
 */
export function pollsGateOf(read: PollsGateRead): PollsGate {
  if (read.pollsEnabled !== undefined) return read.pollsEnabled ? "on" : "off";
  return read.fetchStatus === "fetching" ? "loading" : "error";
}

/**
 * The poll card's withdrawn-Vote reasons while the Polls check hasn't answered:
 * `spec/ui/design-system/writing.md` § Module off, the two rows under "Poll
 * (chat card, web and mobile)".
 */
export const POLLS_GATE_LOADING_COPY =
  "Checking whether polls are on for your chapter…";
export const POLLS_GATE_ERROR_COPY =
  "Couldn't check whether polls are on for your chapter, so voting is paused.";

/**
 * The line a poll card shows under its options when the gate withdraws its
 * Vote, or `null` when it doesn't. A card that takes no vote whatever the
 * module says gets no reason: a closed poll, and a pending or failed row,
 * whose own delivery chrome already says why (a refused send shows
 * {@link POLLS_OFF_COPY} there through {@link memberFacingRefusal}).
 */
export function pollsGateReason(
  gate: PollsGate,
  card: { isClosed: boolean; isConfirmed: boolean },
): string | null {
  if (card.isClosed || !card.isConfirmed || gate === "on") return null;
  if (gate === "off") return POLLS_OFF_COPY;
  return gate === "loading" ? POLLS_GATE_LOADING_COPY : POLLS_GATE_ERROR_COPY;
}

/**
 * A poll sent or voted on while Polls is off is refused with the module
 * gate's sentence to an officer ("Re-enable it in Settings → Modules"), which
 * a member can't act on (#2993). chat-core runs every server message it
 * surfaces through this, so the toast, the failed row's inline error and the
 * persisted outbox error all carry the member's row. Every other message
 * passes through.
 */
export function memberFacingRefusal(message: string): string {
  return moduleRefusalFromServerMessage(message)?.moduleKey === "polls"
    ? POLLS_OFF_COPY
    : message;
}

/**
 * A poll option's id. It only has to be unique within one poll's option list,
 * so it stays a short readable token rather than a full UUID
 * (`randomClientId()` is the right call for anything the server dedupes on).
 * A vote names its option by this id (`payload.option_id`, ADR-07).
 */
export function makePollOptionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** What a client asks for: the poll as the member wrote it. */
export interface PollMessageInput {
  question: string;
  /** Option labels, in the order the card lists them. */
  options: readonly string[];
  /** When voting stops, or `null` for a poll that doesn't close (#3896). */
  closesAt: Date | null;
  /** A member may pick more than one option (#3793). Single-choice if unset. */
  multiple?: boolean;
}

/**
 * The `kind: "poll"` message a client posts: `content` is the question, which
 * is what a notification, the channel preview and search read, and `payload`
 * is the card. Every posting path builds it here, web's `/poll` command
 * (`dispatch.ts`), web's New poll dialog (#3865) and mobile's New poll sheet
 * (#3701), so the card a member
 * votes on can't differ by which client made it. The caller has already
 * validated the text; this only shapes it.
 */
export function buildPollMessage(
  input: PollMessageInput,
  makeOptionId: () => string = makePollOptionId,
): { content: string; payload: PollPayload } {
  return {
    content: input.question,
    payload: {
      question: input.question,
      options: input.options.map((label) => ({ id: makeOptionId(), label })),
      closes_at: input.closesAt ? input.closesAt.toISOString() : null,
      // Only on a multi-choice card, so a single-choice one is built exactly
      // as it was before the mode existed.
      ...(input.multiple ? { choice_mode: "multi" as const } : {}),
    },
  };
}

export function readPollPayload(message: ChatMessage): PollPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const question = (raw as { question?: unknown }).question;
  const options = (raw as { options?: unknown }).options;
  const closesAt = (raw as { closes_at?: unknown }).closes_at;
  if (typeof question !== "string" || !Array.isArray(options)) return null;
  const parsed: PollOption[] = [];
  for (const o of options) {
    if (!o || typeof o !== "object") continue;
    const id = (o as { id?: unknown }).id;
    const label = (o as { label?: unknown }).label;
    if (typeof id === "string" && typeof label === "string") {
      parsed.push({ id, label });
    }
  }
  if (parsed.length < 2) return null;
  const choiceMode = (raw as { choice_mode?: unknown }).choice_mode;
  const closedAt = (raw as { closed_at?: unknown }).closed_at;
  const closedBy = (raw as { closed_by?: unknown }).closed_by;
  return {
    question,
    options: parsed,
    closes_at:
      typeof closesAt === "string" && closesAt !== "" ? closesAt : null,
    // As the API's vote rules read it (`cardPollChoiceMode`): absent or
    // "single" is single-choice, and anything else votes as multi.
    ...(choiceMode != null && choiceMode !== "single"
      ? { choice_mode: "multi" as const }
      : {}),
    // Only on a card closed early (#3794), so an open card reads back exactly
    // as `buildPollMessage` built it.
    ...(typeof closedAt === "string" && closedAt !== ""
      ? {
          closed_at: closedAt,
          closed_by: typeof closedBy === "string" ? closedBy : null,
        }
      : {}),
  };
}

/**
 * Whether a poll card takes no more votes: its creator closed it early
 * (`closed_at`, #3794), or its deadline has passed. The API refuses a vote on
 * either (`ChatReactionService`); this is the same answer for the cards to
 * draw. A card with no deadline (#3896), or one that doesn't parse, never
 * closes on its own, as on the server.
 */
export function isPollCardClosed(payload: PollPayload, now: number): boolean {
  if (payload.closed_at) return true;
  const deadline = parseInstant(payload.closes_at);
  return deadline ? deadline.getTime() < now : false;
}

/**
 * The card's eyebrow on both clients: "Poll", "Poll · Closed", or, for an
 * open poll with no deadline (#3896), "Poll · No end date", so a member can
 * tell it won't close by itself. A timed, open poll reads plain "Poll", as it
 * always has.
 */
export function pollCardEyebrow(payload: PollPayload, now: number): string {
  if (isPollCardClosed(payload, now)) return "Poll · Closed";
  return parseInstant(payload.closes_at) ? "Poll" : "Poll · No end date";
}

/**
 * Whether the viewer is offered Close poll on this card (#3794): the server
 * has it and it isn't deleted (`canActOnMessage`), it is still open, the
 * Polls module is known to be on (the close route requires it), and the
 * viewer may close it. Its creator may (`isOwnMessage`), whatever their
 * permissions now, and so may a member who holds `channels:manage`, so a poll
 * with no deadline whose creator lost `polls:create` or left can still end
 * with its tally kept (#4046). The API enforces all of it
 * (`PollService.close`); this only keeps the card honest.
 */
export function canClosePoll(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  payload: PollPayload,
  viewerId: string | null,
  now: number,
  gates: { pollsGate: PollsGate; canManageChannels: boolean },
): boolean {
  return (
    (isOwnMessage(message, viewerId) ||
      (gates.canManageChannels && !!viewerId)) &&
    canActOnMessage(message) &&
    !isPollCardClosed(payload, now) &&
    gates.pollsGate === "on"
  );
}

/**
 * Close poll asks first, with the same words on web's dialog and mobile's
 * alert: it can't be undone, and it stops everyone's voting at once.
 */
export const CLOSE_POLL_LABEL = "Close poll";
export const CLOSE_POLL_CONFIRM_TITLE = "Close this poll?";
export const CLOSE_POLL_CONFIRM_BODY =
  "No one can vote after it closes, and it can't be reopened. The results stay on the card.";
export const CLOSE_POLL_CONFIRM_LABEL = "Close poll";

/** Whether a member may pick more than one option on this card (#3793). */
export function isMultiChoicePoll(payload: PollPayload): boolean {
  return payload.choice_mode === "multi";
}

export interface PollTally {
  /** How many members picked each option. */
  byOption: Record<string, number>;
  /**
   * Every pick counted: on a single-choice card, the number of members who
   * voted; on a multi-choice one, a member who picked three options adds three.
   */
  total: number;
  /** Members with at least one pick. Equals `total` on a single-choice card. */
  voters: number;
  /** The viewer's picks, in the card's option order: one at most on a single-choice card. */
  myVotes: string[];
}

/**
 * The option ids one vote row names. ADR-07 keeps a member's vote to one
 * `action_type='vote'` row; its `payload.option_id` is one id on a
 * single-choice card and a list of ids on a multi-choice one (#3793, the shape
 * the API's `cardVoteSelection` reads). Ids the card doesn't list are dropped,
 * and an id repeated in one row counts once.
 */
function votePicks(payload: unknown, known: Record<string, number>): string[] {
  const raw = (payload as { option_id?: unknown } | null)?.option_id;
  const picks = new Set<string>();
  for (const id of Array.isArray(raw) ? raw : [raw]) {
    if (typeof id === "string" && id in known) picks.add(id);
  }
  return [...picks];
}

/**
 * Per-option tally derived from the raw `chat_message_actions` rows attached
 * to the message: one vote row per member, changed in place by an UPSERT
 * (ADR-07). Counting from `message.actions` (vs the aggregate `reactions`)
 * keeps the per-option breakdown accurate and lets the viewer's own picks be
 * identified without a server round-trip.
 */
export function tallyPollVotes(
  message: ChatMessage,
  options: PollOption[],
  viewerId: string | null,
): PollTally {
  const byOption: Record<string, number> = {};
  for (const o of options) byOption[o.id] = 0;
  let total = 0;
  let voters = 0;
  let mine = new Set<string>();
  for (const action of message.actions) {
    if (action.action_type !== POLL_VOTE_ACTION_TYPE) continue;
    const picks = votePicks(action.payload, byOption);
    if (picks.length === 0) continue;
    for (const id of picks) byOption[id] = (byOption[id] ?? 0) + 1;
    total += picks.length;
    voters += 1;
    if (viewerId && action.user_id === viewerId) mine = new Set(picks);
  }
  const myVotes = options.map((o) => o.id).filter((id) => mine.has(id));
  return { byOption, total, voters, myVotes };
}

/**
 * The picks a member's last tap on a multi-choice card asked for, while the
 * card may not show them yet. A vote isn't optimistic: the card redraws from
 * the API's answer (`actOnCard`), and each tap sends the member's whole list,
 * so a second tap made before the first answer would be built from the old
 * list and drop the first pick. The card keeps what it last sent and builds
 * the next tap on that (`currentPollPicks`).
 */
export interface PendingPollPicks {
  picks: string[];
  /** `Date.now()` at the tap. */
  at: number;
}

/**
 * How long a tap's picks stand in for the card's. Long enough for a slow
 * answer and its re-read (web's Activity panel re-reads after the POST); after
 * it the card's own picks are the truth again, so a refused vote isn't
 * carried into a tap made much later.
 */
export const POLL_PICKS_PENDING_MS = 10_000;

/** The viewer's picks to build the next tap on: the last tap's while fresh. */
export function currentPollPicks(
  myVotes: readonly string[],
  pending: PendingPollPicks | null,
  now: number,
): readonly string[] {
  return pending && now - pending.at < POLL_PICKS_PENDING_MS
    ? pending.picks
    : myVotes;
}

/**
 * The vote a tap on `optionId` sends. A single-choice card names that option,
 * replacing any earlier pick. A multi-choice card toggles it in the viewer's
 * picks and sends the whole list, in the card's option order; an empty list
 * clears the vote, which the API accepts on a multi-choice card.
 */
export function pollVotePayload(
  payload: PollPayload,
  myVotes: readonly string[],
  optionId: string,
): Record<string, unknown> {
  if (!isMultiChoicePoll(payload)) return { option_id: optionId };
  const picked = new Set(myVotes);
  if (picked.has(optionId)) picked.delete(optionId);
  else picked.add(optionId);
  return {
    option_id: payload.options.map((o) => o.id).filter((id) => picked.has(id)),
  };
}

/**
 * The vote a tap sends from a card, built on the member's last tap while that
 * tap is fresh ({@link PendingPollPicks}), and remembered in `pending` for the
 * next one. A single-choice tap depends on nothing earlier, so it forgets.
 */
export function castPollVote(
  payload: PollPayload,
  myVotes: readonly string[],
  pending: { current: PendingPollPicks | null },
  optionId: string,
  now: number = Date.now(),
): Record<string, unknown> {
  const vote = pollVotePayload(
    payload,
    currentPollPicks(myVotes, pending.current, now),
    optionId,
  );
  pending.current = Array.isArray(vote.option_id)
    ? { picks: vote.option_id as string[], at: now }
    : null;
  return vote;
}

/**
 * An option's share, as the bar and the "N%" beside it show it. Single-choice:
 * its share of the votes. Multi-choice: the share of voters who picked it, so
 * the options needn't add up to 100.
 */
export function pollOptionPercent(
  payload: PollPayload,
  tally: PollTally,
  optionId: string,
): number {
  const of = isMultiChoicePoll(payload) ? tally.voters : tally.total;
  return of > 0 ? Math.round(((tally.byOption[optionId] ?? 0) / of) * 100) : 0;
}

/**
 * The line under a multi-choice card's question, or `null` on a single-choice
 * card, which has none.
 */
export function pollChoiceHint(
  payload: PollPayload,
  isClosed: boolean,
): string | null {
  if (!isMultiChoicePoll(payload)) return null;
  return isClosed ? "More than one choice was allowed" : "Select one or more";
}

/** The card's footer line under its options, the same on both clients. */
export function pollCardFooter(
  payload: PollPayload,
  tally: PollTally,
  canVote: boolean,
): string {
  if (tally.voters === 0) {
    return `No votes yet${canVote ? " · be the first to vote" : ""}.`;
  }
  const mine = tally.myVotes.length > 0;
  if (isMultiChoicePoll(payload)) {
    const people = tally.voters === 1 ? "1 person" : `${tally.voters} people`;
    return `${people} voted${mine ? " · your choices are highlighted" : ""}`;
  }
  return `${tally.total} vote${tally.total === 1 ? "" : "s"}${mine ? " · your vote is highlighted" : ""}`;
}

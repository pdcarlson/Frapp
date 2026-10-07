import { moduleRefusalFromServerMessage } from "@repo/validation";
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
  return {
    question,
    options: parsed,
    closes_at: typeof closesAt === "string" ? closesAt : "",
  };
}

export interface PollTally {
  byOption: Record<string, number>;
  total: number;
  myVote: string | null;
}

/**
 * Per-option tally derived from the raw `chat_message_actions` rows attached
 * to the message. ADR-07: the wire format uses a single `action_type='vote'`
 * row per user, with the option id in `payload.option_id`; vote-change
 * UPSERTs the same row. Counting from `message.actions` (vs the aggregate
 * `reactions`) keeps the per-option breakdown accurate and lets the viewer's
 * chosen option be identified without a server round-trip.
 */
export function tallyPollVotes(
  message: ChatMessage,
  options: PollOption[],
  viewerId: string | null,
): PollTally {
  const byOption: Record<string, number> = {};
  for (const o of options) byOption[o.id] = 0;
  let total = 0;
  let myVote: string | null = null;
  for (const action of message.actions) {
    if (action.action_type !== POLL_VOTE_ACTION_TYPE) continue;
    const optionId = (action.payload as { option_id?: unknown } | null)
      ?.option_id;
    if (typeof optionId !== "string" || !(optionId in byOption)) continue;
    byOption[optionId] = (byOption[optionId] ?? 0) + 1;
    total += 1;
    if (viewerId && action.user_id === viewerId) myVote = optionId;
  }
  return { byOption, total, myVote };
}

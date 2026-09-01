import type { ChatMessage } from "./types";

/**
 * Poll payload parsing and vote-tally logic, shared by web's
 * `apps/web/components/chat/renderers/poll-card.tsx` and mobile's
 * `apps/mobile/components/chat/poll-card.tsx` (#528) so a future fix to
 * either only has one place to land.
 *
 * `PollOption`/`PollPayload`/`POLL_VOTE_ACTION_TYPE` mirror the canonical
 * definitions in `packages/chat-integrations/src/payloads.ts` rather than
 * importing them: `@repo/chat-core` is a mobile dependency, and
 * `chat-integrations`'s `exports` map points the `require` condition — the
 * one Metro's resolver uses — at an unbuilt `dist/` (#989), so nothing
 * `chat-core` exports can afford to pull that package in, even transitively.
 * The shape is small and frozen by the wire contract (ADR-07's
 * `action_type: "vote"` / `payload.option_id`), so duplicating it here —
 * once, rather than once per platform — is safe.
 */

export interface PollOption {
  id: string;
  label: string;
}

export interface PollPayload {
  question: string;
  options: PollOption[];
  closes_at: string;
}

export const POLL_VOTE_ACTION_TYPE = "vote";

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

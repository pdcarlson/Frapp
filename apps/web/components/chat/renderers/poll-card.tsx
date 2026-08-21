"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  POLL_VOTE_ACTION_TYPE,
  type PollOption,
  type PollPayload,
} from "@repo/chat-integrations";
import { useNow } from "@/lib/use-now";

interface PollCardProps {
  message: ChatMessage;
  viewerId: string | null;
  /** Confirmed messages can be voted on; pending optimistic rows cannot. */
  isConfirmed: boolean;
  onVote: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
}

function readPayload(message: ChatMessage): PollPayload | null {
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

/**
 * Per-option tally derived from the raw `chat_message_actions` rows
 * attached to the message. ADR-07: the wire format uses a single
 * `action_type='vote'` row per user, with the option id in
 * `payload.option_id`; vote-change UPSERTs the same row. Counting from
 * `message.actions` (vs the aggregate `reactions`) keeps the per-option
 * breakdown accurate and lets the viewer's chosen option be identified
 * without a server round-trip.
 */
function tallyByOption(
  message: ChatMessage,
  options: PollOption[],
  viewerId: string | null,
): { byOption: Record<string, number>; total: number; myVote: string | null } {
  const byOption: Record<string, number> = {};
  for (const o of options) byOption[o.id] = 0;
  let total = 0;
  let myVote: string | null = null;
  for (const action of message.actions) {
    if (action.action_type !== POLL_VOTE_ACTION_TYPE) continue;
    const optionId = (action.payload as { option_id?: unknown } | null)?.option_id;
    if (typeof optionId !== "string" || !(optionId in byOption)) continue;
    byOption[optionId] = (byOption[optionId] ?? 0) + 1;
    total += 1;
    if (viewerId && action.user_id === viewerId) myVote = optionId;
  }
  return { byOption, total, myVote };
}

/**
 * Poll card: question + options. Pre-vote shows option buttons; post-vote
 * shows bar tallies with the viewer's choice highlighted. Vote-change is
 * supported via ADR-07's UPSERT semantics — the user can tap a different
 * option and the prior vote is replaced.
 */
export function PollCard({
  message,
  viewerId,
  isConfirmed,
  onVote,
}: PollCardProps) {
  const payload = readPayload(message);
  const now = useNow();

  const { byOption, total, myVote: viewerVote } = useMemo(() => {
    if (!payload) return { byOption: {}, total: 0, myVote: null };
    return tallyByOption(message, payload.options, viewerId);
  }, [message, payload, viewerId]);

  if (!payload) {
    return (
      <div className="mt-1 rounded-md border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
        Malformed poll · {message.content}
      </div>
    );
  }

  const closesAt = payload.closes_at ? new Date(payload.closes_at) : null;
  const isClosed = closesAt
    ? !Number.isNaN(closesAt.getTime()) && closesAt.getTime() < now
    : false;
  const canVote = isConfirmed && !isClosed && viewerId !== null;

  const cast = (option: PollOption) => {
    if (!canVote) return;
    onVote(message.id, POLL_VOTE_ACTION_TYPE, { option_id: option.id });
  };

  return (
    <div className="mt-1 rounded-md border bg-card px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Poll{isClosed ? " · Closed" : ""}
      </div>
      <div className="mt-1 text-sm font-semibold">{payload.question}</div>
      <ul className="mt-2 space-y-1.5">
        {payload.options.map((option) => {
          const count = byOption[option.id] ?? 0;
          const denom = total > 0 ? total : 1;
          const pct = total > 0 ? Math.round((count / denom) * 100) : 0;
          const isMyVote = viewerVote === option.id;
          return (
            <li key={option.id}>
              <Button
                type="button"
                variant={isMyVote ? "default" : "secondary"}
                size="sm"
                className="w-full justify-between gap-2 text-left text-xs"
                onClick={() => cast(option)}
                disabled={!canVote}
                aria-pressed={isMyVote}
              >
                <span className="truncate">{option.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {count} · {pct}%
                </span>
              </Button>
              <div
                className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-secondary"
                aria-hidden="true"
              >
                <div
                  className="h-full bg-[color:var(--accent-text)]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {total === 0 ? (
        <div className="mt-2 text-[11px] text-muted-foreground">
          No votes yet
          {canVote ? " · be the first to vote" : ""}.
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-muted-foreground">
          {total} vote{total === 1 ? "" : "s"}
          {viewerVote ? " · your vote is highlighted" : ""}
        </div>
      )}
    </div>
  );
}

export { tallyByOption };

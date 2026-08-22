"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
      <div className="mt-1 rounded-lg border border-border bg-card p-4 text-base text-muted-foreground">
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

  // `bg-card` on a `bg-card` pane was invisible; the thread is `--background`
  // now, so a card here reads as the step above it (foundations §2).
  return (
    <Card className={cn(MESSAGE_CARD)}>
      <p className={cn(EYEBROW, "text-muted-foreground")}>
        Poll{isClosed ? " · Closed" : ""}
      </p>
      <div className="mt-2 text-base font-bold">{payload.question}</div>
      <ul className="mt-3 space-y-2">
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
                className="w-full justify-between gap-2 text-left"
                onClick={() => cast(option)}
                disabled={!canVote}
                aria-pressed={isMyVote}
              >
                <span className="truncate">{option.label}</span>
                {/*
                  Inherits the button's own foreground. It used to be pinned to
                  `text-muted-foreground`, which on the voted option painted
                  #A9A399 on the `--primary` fill — about 1.9:1, far under the
                  4.5:1 text floor. A label inside a filled control has exactly
                  one correct colour, and the variant already sets it.
                */}
                <span className="font-mono tabular-nums">
                  {count} · {pct}%
                </span>
              </Button>
              <div
                className="mt-1 h-1 w-full overflow-hidden rounded-full bg-input"
                aria-hidden="true"
              >
                <div
                  className="h-full bg-primary"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {total === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          No votes yet
          {canVote ? " · be the first to vote" : ""}.
        </p>
      ) : (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          {total} vote{total === 1 ? "" : "s"}
          {viewerVote ? " · your vote is highlighted" : ""}
        </p>
      )}
    </Card>
  );
}

export { tallyByOption };

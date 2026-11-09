"use client";

import { useId, useMemo } from "react";
import {
  meterFillClassName,
  meterTrackDenseClassName,
} from "@/components/shared/meter";
import { Button } from "@/components/ui/button";
import { CHIP, CHIP_HIT_AREA, EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { useChapterModuleGateState } from "@/lib/hooks/use-chapter-module-gate";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  CLOSE_POLL_LABEL,
  POLL_VOTE_ACTION_TYPE,
  canClosePoll,
  isPollCardClosed,
  pollsGateOf,
  pollsGateReason,
  readPollPayload,
  tallyPollVotes,
  type PollOption,
} from "@repo/chat-core/polls";
import { useNow } from "@repo/hooks";

interface PollCardProps {
  message: ChatMessage;
  /** Known, never `null` — see `MessageRendererProps.viewerId`. */
  viewerId: string;
  /** Confirmed messages can be voted on; pending optimistic rows cannot. */
  isConfirmed: boolean;
  onVote: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
  /**
   * Close poll on the viewer's own open poll (#3794). The caller confirms
   * first (`ChatShell`); the card only offers it (`canClosePoll`).
   */
  onClosePoll?: (messageId: string) => void;
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
  onClosePoll,
}: PollCardProps) {
  const payload = readPollPayload(message);
  const now = useNow();
  // A card vote is a Polls write, and the server refuses it while Polls is off
  // (#2993). The gate is mirrored here so the member sees that before tapping
  // (#3012). It reads the member view, never the officer-only config, and fails
  // closed until that read answers, saying whether it is still running or
  // needs a Retry (`pollsGateOf`, shared with mobile). A missing `polls` key
  // is on.
  const moduleGate = useChapterModuleGateState();
  const pollsGate = pollsGateOf({
    pollsEnabled:
      moduleGate.status === "ready"
        ? moduleGate.isModuleEnabled("polls")
        : undefined,
    fetchStatus: moduleGate.fetchStatus,
  });
  const gateReasonId = useId();

  const {
    byOption,
    total,
    myVote: viewerVote,
  } = useMemo(() => {
    if (!payload) return { byOption: {}, total: 0, myVote: null };
    return tallyPollVotes(message, payload.options, viewerId);
  }, [message, payload, viewerId]);

  if (!payload) {
    return (
      <div className="mt-1 rounded-lg border border-border bg-card p-4 text-base text-muted-foreground">
        Malformed poll · {message.content}
      </div>
    );
  }

  // Closed by its deadline or, early, by its creator (#3794). The server row's
  // `payload.closed_at` arrives as a Realtime UPDATE, so every open card
  // redraws closed the moment the creator closes it.
  const isClosed = isPollCardClosed(payload, now);
  const showClose =
    !!onClosePoll && canClosePoll(message, payload, viewerId, now);
  /*
    `!viewerId`, not `!== null`. The prop says `string` now, but a JSX spread of
    a loosely-typed object is not prop-checked, so `undefined` can still arrive
    with the compiler silent — and `undefined !== null` is true, which opened
    this. The same hole `message-timeline.tsx`'s gate spells out and guards
    against; an unusable id is an unresolved viewer whatever shape it arrives in.
  */
  const canVote = isConfirmed && !isClosed && !!viewerId && pollsGate === "on";
  const gateReason = pollsGateReason(pollsGate, { isClosed, isConfirmed });

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
                aria-describedby={gateReason ? gateReasonId : undefined}
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
                className={`mt-1 ${meterTrackDenseClassName}`}
                aria-hidden="true"
              >
                <div
                  className={meterFillClassName}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {total === 0 ? (
          <p className="text-caption text-muted-foreground">
            No votes yet
            {canVote ? " · be the first to vote" : ""}.
          </p>
        ) : (
          <p className="text-caption text-muted-foreground">
            {total} vote{total === 1 ? "" : "s"}
            {viewerVote ? " · your vote is highlighted" : ""}
          </p>
        )}
        {showClose ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={() => onClosePoll?.(message.id)}
          >
            {CLOSE_POLL_LABEL}
          </Button>
        ) : null}
      </div>
      {gateReason ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          <p id={gateReasonId}>{gateReason}</p>
          {pollsGate === "error" ? (
            <button
              type="button"
              className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA)}
              onClick={moduleGate.retry}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

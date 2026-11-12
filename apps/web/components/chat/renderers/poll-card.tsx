"use client";

import { useId, useMemo, useRef } from "react";
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
  castPollVote,
  isPollCardClosed,
  pollCardEyebrow,
  pollCardFooter,
  pollChoiceHint,
  pollOptionPercent,
  pollsGateOf,
  pollsGateReason,
  readPollPayload,
  tallyPollVotes,
  type PendingPollPicks,
  type PollOption,
} from "@repo/chat-core/polls";
import { useMyPermissions, useNow } from "@repo/hooks";
import { can } from "@repo/validation";

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
   * Close poll on an open poll the viewer started, or on anyone's for a
   * `channels:manage` holder (#3794, #4046). The caller confirms
   * first (`ChatShell`); the card only offers it (`canClosePoll`).
   */
  onClosePoll?: (messageId: string) => void;
}

/**
 * Poll card: question + options. Pre-vote shows option buttons; post-vote
 * shows bar tallies with the viewer's choice highlighted. Vote-change is
 * supported via ADR-07's UPSERT semantics — the user can tap a different
 * option and the prior vote is replaced. On a multi-choice card (#3793) a tap
 * adds or clears that option instead, and the same one row carries the list
 * (`pollVotePayload`).
 */
export function PollCard({
  message,
  viewerId,
  isConfirmed,
  onVote,
  onClosePoll,
}: PollCardProps) {
  const payload = useMemo(() => readPollPayload(message), [message]);
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
  // A `channels:manage` holder may close anyone's poll, as its creator may
  // their own (#4046). Unknown until the read lands, which offers it to the
  // creator only.
  const canManageChannels = can(
    "channels:manage",
    useMyPermissions().data?.permissions,
  );

  const tally = useMemo(
    () => tallyPollVotes(message, payload?.options ?? [], viewerId),
    [message, payload, viewerId],
  );
  const pendingPicks = useRef<PendingPollPicks | null>(null);

  if (!payload) {
    return (
      <div className="mt-1 rounded-lg border border-border bg-card p-4 text-base text-muted-foreground">
        Malformed poll · {message.content}
      </div>
    );
  }

  // Closed by its deadline or, early, by its creator or a moderator (#3794). The server row's
  // `payload.closed_at` arrives as a Realtime UPDATE, so every open card
  // redraws closed the moment the creator closes it.
  const isClosed = isPollCardClosed(payload, now);
  const showClose =
    !!onClosePoll &&
    canClosePoll(message, payload, viewerId, now, {
      pollsGate,
      canManageChannels,
    });
  /*
    `!viewerId`, not `!== null`. The prop says `string` now, but a JSX spread of
    a loosely-typed object is not prop-checked, so `undefined` can still arrive
    with the compiler silent — and `undefined !== null` is true, which opened
    this. The same hole `message-timeline.tsx`'s gate spells out and guards
    against; an unusable id is an unresolved viewer whatever shape it arrives in.
  */
  const canVote = isConfirmed && !isClosed && !!viewerId && pollsGate === "on";
  const gateReason = pollsGateReason(pollsGate, { isClosed, isConfirmed });
  const choiceHint = pollChoiceHint(payload, isClosed);

  const cast = (option: PollOption) => {
    if (!canVote) return;
    // Built on the member's last tap while its answer is still on the way
    // (`castPollVote`), so two quick taps on a multi-choice card keep both.
    onVote(
      message.id,
      POLL_VOTE_ACTION_TYPE,
      castPollVote(payload, tally.myVotes, pendingPicks, option.id),
    );
  };

  // `bg-card` on a `bg-card` pane was invisible; the thread is `--background`
  // now, so a card here reads as the step above it (foundations §2).
  return (
    <Card className={cn(MESSAGE_CARD)}>
      <p className={cn(EYEBROW, "text-muted-foreground")}>
        {pollCardEyebrow(payload, now)}
      </p>
      <div className="mt-2 text-base font-bold">{payload.question}</div>
      {choiceHint ? (
        <p className="mt-1 text-caption text-muted-foreground">{choiceHint}</p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {payload.options.map((option) => {
          const count = tally.byOption[option.id] ?? 0;
          const pct = pollOptionPercent(payload, tally, option.id);
          const isMyVote = tally.myVotes.includes(option.id);
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
        <p className="text-caption text-muted-foreground">
          {pollCardFooter(payload, tally, canVote)}
        </p>
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

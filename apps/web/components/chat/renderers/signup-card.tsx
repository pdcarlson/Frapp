"use client";

import { useId, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import {
  meterFillClassName,
  meterTrackDenseClassName,
} from "@/components/shared/meter";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import type { PendingPollPicks } from "@repo/chat-core/polls";
import {
  SIGNUP_CLAIM_ACTION_TYPE,
  castSignupClaim,
  readSignupPayload,
  signupCardEyebrow,
  signupCardFooter,
  signupHoldersLine,
  signupSlotAction,
  signupSlotPercent,
  signupSlotSpoken,
  signupSlotStatus,
  tallySignups,
} from "@repo/chat-core/signups";
import { actorLabel, type NameResolver } from "@repo/hooks";

interface SignupCardProps {
  message: ChatMessage;
  /** Known, never `null`: see `MessageRendererProps.viewerId`. */
  viewerId: string;
  /** The row's roster lookup, for the names on each slot. */
  nameFor: NameResolver;
  /** Confirmed messages can be signed up on; pending optimistic rows cannot. */
  isConfirmed: boolean;
  onClaim: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
}

/**
 * A sign-up sheet card (`kind: "signup"`, #3926): slots with a limit (or
 * none), each a row drawn as the poll card draws an option, with a meter
 * for a slot with a limit and who holds it named on one line under it, as
 * iMessage and Discord polls name voters. A tap on a row takes the slot or
 * gives it up; a full slot can't be taken and says Full, and the API
 * refuses a tap that lost the last spot to someone else (409), which the
 * channel's card-action error path shows in the API's words
 * (`SERVER_MESSAGE_COPY` in `@repo/validation`). Reading, counting and the words are
 * `@repo/chat-core/signups`, shared with the phone's card.
 */
export function SignupCard({
  message,
  viewerId,
  nameFor,
  isConfirmed,
  onClaim,
}: SignupCardProps) {
  const payload = useMemo(() => readSignupPayload(message), [message]);
  const tally = useMemo(
    () => (payload ? tallySignups(message, payload, viewerId) : null),
    [message, payload, viewerId],
  );
  const pending = useRef<PendingPollPicks | null>(null);
  const countId = useId();

  if (!payload || !tally) {
    return (
      <div className="mt-1 rounded-lg border border-border bg-card p-4 text-base text-muted-foreground">
        Malformed sign-up · {message.content}
      </div>
    );
  }

  // `!viewerId`, not `!== null`, for the reason the poll card gives.
  const canClaim = isConfirmed && !!viewerId;
  const claim = (slotId: string) => {
    if (!canClaim) return;
    onClaim(
      message.id,
      SIGNUP_CLAIM_ACTION_TYPE,
      castSignupClaim(payload, tally, pending, slotId),
    );
  };

  return (
    <Card
      className={cn(MESSAGE_CARD, "w-full min-w-[min(20rem,100%)] max-w-md")}
    >
      <p className={cn(EYEBROW, "text-muted-foreground")}>
        {signupCardEyebrow(payload, tally)}
      </p>
      <div className="mt-2 text-base font-bold">{payload.title}</div>
      {payload.note ? (
        <p className="mt-1 whitespace-pre-wrap text-caption text-muted-foreground">
          {payload.note}
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {payload.slots.map((slot) => {
          const action = signupSlotAction(slot, tally);
          const holders = tally.bySlot[slot.id] ?? [];
          const percent = signupSlotPercent(slot, tally);
          const names = signupHoldersLine(
            holders,
            viewerId,
            (userId) => actorLabel(userId, nameFor) ?? "A member",
          );
          return (
            <li key={slot.id}>
              <Button
                type="button"
                size="sm"
                variant={action.held ? "default" : "secondary"}
                className="h-auto min-h-9 w-full justify-between gap-2 whitespace-normal py-1.5 text-left pointer-coarse:h-auto pointer-coarse:min-h-11"
                disabled={!canClaim || action.full}
                aria-pressed={action.held}
                aria-label={`${action.label}: ${slot.label}`}
                aria-describedby={`${countId}-${slot.id}`}
                onClick={() => claim(slot.id)}
              >
                <span className="min-w-0 break-words">{slot.label}</span>
                {/* The button's own foreground, as the poll card's tally. */}
                <span className="shrink-0 font-mono tabular-nums">
                  {signupSlotStatus(slot, tally)}
                </span>
              </Button>
              <span id={`${countId}-${slot.id}`} className="sr-only">
                {signupSlotSpoken(slot, tally)}
              </span>
              {percent !== null ? (
                <div
                  className={`mt-1 ${meterTrackDenseClassName}`}
                  aria-hidden="true"
                >
                  <div
                    className={meterFillClassName}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              ) : null}
              {names ? (
                <p className="mt-1 line-clamp-2 px-1 text-caption text-muted-foreground">
                  {names}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-caption text-muted-foreground">
        {signupCardFooter(payload, tally)}
      </p>
    </Card>
  );
}

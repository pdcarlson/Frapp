"use client";

import { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CHIP, EYEBROW, MESSAGE_CARD } from "../chip";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import type { PendingPollPicks } from "@repo/chat-core/polls";
import {
  SIGNUP_CLAIM_ACTION_TYPE,
  castSignupClaim,
  readSignupPayload,
  signupCardEyebrow,
  signupCardFooter,
  signupSlotAction,
  signupSlotCount,
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
 * none), who holds each, and a Sign up / Signed up button per slot. A tap
 * takes the slot or gives it up; a full slot can't be taken, and the API
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
          return (
            <li
              key={slot.id}
              className={cn(
                "rounded-md border p-3",
                action.held
                  ? "border-accent-border bg-accent-subtle"
                  : "border-border",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words font-semibold">
                  {slot.label}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className="font-mono text-caption tabular-nums text-muted-foreground"
                    aria-label={
                      slot.capacity === null
                        ? `${holders.length} signed up`
                        : `${holders.length} of ${slot.capacity} spots taken`
                    }
                  >
                    {signupSlotCount(slot, tally)}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant={action.held ? "default" : "secondary"}
                    disabled={!canClaim || action.full}
                    aria-pressed={action.held}
                    aria-label={`${action.label}: ${slot.label}`}
                    onClick={() => claim(slot.id)}
                  >
                    {action.held ? `${action.label} ✓` : action.label}
                  </Button>
                </span>
              </div>
              {holders.length > 0 ? (
                <ul
                  className="mt-2 flex flex-wrap gap-1.5"
                  aria-label="Signed up"
                >
                  {holders.map((userId) => (
                    <li
                      key={userId}
                      className={cn(
                        CHIP.base,
                        userId === viewerId ? CHIP.accent : CHIP.neutral,
                      )}
                    >
                      {userId === viewerId
                        ? "You"
                        : (actorLabel(userId, nameFor) ?? "A member")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-caption text-muted-foreground">
                  {slot.capacity === null
                    ? "No limit · no one yet"
                    : "No one yet"}
                </p>
              )}
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

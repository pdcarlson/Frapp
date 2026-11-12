"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CHIP, EYEBROW, MESSAGE_CARD } from "../chip";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import type { PendingPollPicks } from "@repo/chat-core/polls";
import {
  CLOSE_SIGNUP_LABEL,
  SIGNUP_CLAIM_ACTION_TYPE,
  canCloseSignup,
  castSignupClaim,
  headcountAnswerPayload,
  headcountNotePayload,
  type PendingHeadcount,
  isHeadcountSignup,
  isSignupClosed,
  readSignupPayload,
  signupDeadlineLine,
  signupCardEyebrow,
  signupCardFooter,
  signupSlotAction,
  signupSlotCount,
  tallySignups,
} from "@repo/chat-core/signups";
import {
  actorLabel,
  useMyPermissions,
  useNow,
  type NameResolver,
} from "@repo/hooks";
import { can, SIGNUP_ANSWER_NOTE_MAX_LENGTH } from "@repo/validation";

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
  /**
   * Close sign-ups, offered to the card's creator or a `channels:manage`
   * holder (`canCloseSignup`). The caller confirms first (`ChatShell`).
   */
  onCloseSignup?: (messageId: string) => void;
}

/**
 * A sign-up sheet card (`kind: "signup"`, #3926): slots with a limit (or
 * none), who holds each, and a Sign up / Signed up button per slot. A tap
 * takes the slot or gives it up; a full slot can't be taken, and the API
 * refuses a tap that lost the last spot to someone else (409), which the
 * channel's card-action error path shows in the API's words
 * (`SERVER_MESSAGE_COPY` in `@repo/validation`). Reading, counting and the words are
 * `@repo/chat-core/signups`, shared with the phone's card.
 *
 * A headcount (step 2) draws its two answers, Going and Can't make it, the
 * same way, and the viewer may add a short note to theirs, shown under their
 * name. A closed card (its end time passed, or closed early) keeps its names
 * and takes no taps.
 */
export function SignupCard({
  message,
  viewerId,
  nameFor,
  isConfirmed,
  onClaim,
  onCloseSignup,
}: SignupCardProps) {
  const payload = useMemo(() => readSignupPayload(message), [message]);
  const tally = useMemo(
    () => (payload ? tallySignups(message, payload, viewerId) : null),
    [message, payload, viewerId],
  );
  const pending = useRef<PendingPollPicks | null>(null);
  // The last headcount tap, until the card catches up (`PendingHeadcount`).
  const pendingAnswer = useRef<PendingHeadcount | null>(null);
  const now = useNow();
  const canManageChannels = can(
    "channels:manage",
    useMyPermissions().data?.permissions,
  );
  // The note being typed, or `null` while the editor is shut.
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  if (!payload || !tally) {
    return (
      <div className="mt-1 rounded-lg border border-border bg-card p-4 text-base text-muted-foreground">
        Malformed sign-up · {message.content}
      </div>
    );
  }

  // `!viewerId`, not `!== null`, for the reason the poll card gives.
  const closed = isSignupClosed(payload, now);
  const headcount = isHeadcountSignup(payload);
  const canClaim = isConfirmed && !!viewerId && !closed;
  const showClose =
    !!onCloseSignup &&
    canCloseSignup(message, payload, viewerId, now, canManageChannels);
  const deadline = signupDeadlineLine(payload, now);
  const myNote = tally.notes[viewerId] ?? "";
  const claim = (slotId: string) => {
    if (!canClaim) return;
    onClaim(
      message.id,
      SIGNUP_CLAIM_ACTION_TYPE,
      headcount
        ? headcountAnswerPayload(tally, viewerId, pendingAnswer, slotId)
        : castSignupClaim(payload, tally, pending, slotId),
    );
  };
  const saveNote = () => {
    if (noteDraft === null) return;
    const next = headcountNotePayload(
      tally,
      viewerId,
      pendingAnswer,
      noteDraft,
    );
    setNoteDraft(null);
    if (!canClaim || !next) return;
    onClaim(message.id, SIGNUP_CLAIM_ACTION_TYPE, next);
  };

  return (
    <Card
      className={cn(MESSAGE_CARD, "w-full min-w-[min(20rem,100%)] max-w-md")}
    >
      <p className={cn(EYEBROW, "text-muted-foreground")}>
        {signupCardEyebrow(payload, tally, now)}
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
                    hidden={closed && !action.held}
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
                      {tally.notes[userId] ? (
                        <span className="text-muted-foreground">
                          {" · "}
                          {tally.notes[userId]}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-caption text-muted-foreground">
                  {headcount
                    ? "No one yet"
                    : slot.capacity === null
                      ? "No limit · no one yet"
                      : "No one yet"}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {headcount && canClaim && tally.mine.length > 0 ? (
        noteDraft === null ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="mt-2 h-auto px-0"
            onClick={() => setNoteDraft(myNote)}
          >
            {myNote ? "Edit your note" : "Add a note"}
          </Button>
        ) : (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveNote();
            }}
          >
            <Input
              autoFocus
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setNoteDraft(null);
              }}
              maxLength={SIGNUP_ANSWER_NOTE_MAX_LENGTH}
              placeholder="Running late, bringing a friend…"
              aria-label="Note on your answer"
              className="h-8 min-w-0 flex-1"
            />
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setNoteDraft(null)}
            >
              Cancel
            </Button>
          </form>
        )
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-caption text-muted-foreground">
          {signupCardFooter(payload, tally)}
          {deadline ? ` · ${deadline}` : ""}
        </p>
        {showClose ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={() => onCloseSignup?.(message.id)}
          >
            {CLOSE_SIGNUP_LABEL}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

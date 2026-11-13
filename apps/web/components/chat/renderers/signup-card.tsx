"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import {
  meterFillClassName,
  meterTrackDenseClassName,
} from "@/components/shared/meter";
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
  signupHoldersLine,
  signupSlotAction,
  signupSlotPercent,
  signupSlotSpoken,
  signupSlotStatus,
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
 * none), each a row drawn as the poll card draws an option, with a meter
 * for a slot with a limit and who holds it named on one line under it, as
 * iMessage and Discord polls name voters. A tap on a row takes the slot or
 * gives it up; a full slot can't be taken and says Full, and the API
 * refuses a tap that lost the last spot to someone else (409), which the
 * channel's card-action error path shows in the API's words
 * (`SERVER_MESSAGE_COPY` in `@repo/validation`). Reading, counting and the words are
 * `@repo/chat-core/signups`, shared with the phone's card.
 *
 * A headcount (step 2) draws its two answers, Going and Can't make it, as
 * the same rows, and the viewer may add a short note to theirs, shown after
 * their name. A closed card (its end time passed, or closed early) keeps its
 * names and takes no taps.
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
  const countId = useId();
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
    <Card className={MESSAGE_CARD}>
      <p className={cn(EYEBROW, "text-muted-foreground")}>
        {signupCardEyebrow(payload, tally, now)}
      </p>
      <div className="mt-2 text-base font-bold">{payload.title}</div>
      {payload.note ? (
        <p className="mt-2 whitespace-pre-wrap text-caption text-muted-foreground">
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
            3,
            tally.notes,
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

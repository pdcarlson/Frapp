"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  addSignupSlot,
  buildSignupMessage,
  canAddSignupSlot,
  canRemoveSignupSlot,
  checkSignupDraft,
  removeSignupSlot,
  setSignupSlot,
  type SignupDraft,
  type SignupPayload,
} from "@repo/chat-core/signups";
import {
  SIGNUP_NOTE_MAX_LENGTH,
  SIGNUP_SLOT_LABEL_MAX_LENGTH,
  SIGNUP_SLOTS_MAX,
  SIGNUP_TITLE_MAX_LENGTH,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FormFooter,
  fieldClass,
  primarySize,
  useReportDraft,
} from "@/components/shared/short-form";
import { cn } from "@/lib/utils";

/**
 * The composer's New sign-up sheet form (#3926), inside the + card: a title,
 * optional details, and up to twenty slots, each a name and how many spots it
 * has (blank is no limit). The web twin of the phone's New sign-up sheet
 * (`apps/mobile/components/chat/new-signup-sheet.tsx`): one draft model and
 * one card builder (`@repo/chat-core/signups`). Posting goes through the
 * outbox like a poll, so it works offline and a server refusal lands on the
 * card's own failed row; this form reports only an outbox that refused it.
 */
export interface SignupFormProps {
  initialDraft: SignupDraft;
  onDraftChange?: (draft: SignupDraft) => void;
  /** Queues the card in the channel the form was opened in. Never rejects. */
  onPost: (signup: {
    content: string;
    payload: SignupPayload;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDone: () => void;
  onDiscard: () => void;
}

export function SignupForm({
  initialDraft,
  onDraftChange,
  onPost,
  onDone,
  onDiscard,
}: SignupFormProps) {
  const layout = "card";
  const field = fieldClass(layout);
  const [draft, setDraft] = useState<SignupDraft>(initialDraft);
  useReportDraft(draft, onDraftChange);
  const [failure, setFailure] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const sending = useRef(false);

  const check = useMemo(() => checkSignupDraft(draft), [draft]);
  const problem = failure ?? (check.ok ? null : check.problem);
  const problemRow = !failure && !check.ok ? check.slotKey : undefined;

  const edit = useCallback((next: (current: SignupDraft) => SignupDraft) => {
    setDraft(next);
    setFailure(null);
  }, []);

  const post = useCallback(() => {
    if (!check.ok || sending.current) return;
    sending.current = true;
    setPosting(true);
    setFailure(null);
    void onPost(buildSignupMessage(check.input))
      .catch((): { ok: false; error: string } => ({
        ok: false,
        error: "Couldn't post that sign-up sheet. Try again.",
      }))
      .then((result) => {
        sending.current = false;
        setPosting(false);
        if (result.ok) {
          onDone();
          return;
        }
        setFailure(result.error);
      });
  }, [check, onPost, onDone]);

  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        post();
      }}
    >
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Title</span>
        <Input
          value={draft.title}
          onChange={(event) =>
            edit((current) => ({ ...current, title: event.target.value }))
          }
          placeholder="Sober drivers this weekend"
          maxLength={SIGNUP_TITLE_MAX_LENGTH}
          className={field}
          disabled={posting}
          data-plus-autofocus
        />
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Details (optional)</span>
        <Textarea
          rows={2}
          value={draft.note}
          onChange={(event) =>
            edit((current) => ({ ...current, note: event.target.value }))
          }
          placeholder="Times, where to meet, what to bring"
          maxLength={SIGNUP_NOTE_MAX_LENGTH}
          disabled={posting}
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm text-muted-foreground">
          Slots · leave Spots blank for no limit
        </legend>
        {draft.slots.map((slot, index) => (
          <div key={slot.key} className="flex items-center gap-1">
            <Input
              value={slot.label}
              onChange={(event) =>
                edit((current) =>
                  setSignupSlot(current, slot.key, {
                    label: event.target.value,
                  }),
                )
              }
              placeholder={index === 0 ? "Friday" : `Slot ${index + 1}`}
              aria-label={`Slot ${index + 1} name`}
              aria-invalid={problemRow === slot.key || undefined}
              maxLength={SIGNUP_SLOT_LABEL_MAX_LENGTH}
              className={cn(field, "min-w-0 flex-1")}
              disabled={posting}
            />
            <Input
              value={slot.capacity}
              onChange={(event) =>
                edit((current) =>
                  setSignupSlot(current, slot.key, {
                    capacity: event.target.value,
                  }),
                )
              }
              inputMode="numeric"
              placeholder="Spots"
              aria-label={`Slot ${index + 1} spots`}
              aria-invalid={problemRow === slot.key || undefined}
              maxLength={3}
              className={cn(field, "w-20 shrink-0 text-center")}
              disabled={posting}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={`Remove slot ${index + 1}`}
              disabled={posting || !canRemoveSignupSlot(draft)}
              onClick={() =>
                edit((current) => removeSignupSlot(current, slot.key))
              }
            >
              <span aria-hidden="true">×</span>
            </Button>
          </div>
        ))}
        {canAddSignupSlot(draft) ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={posting}
            onClick={() => edit(addSignupSlot)}
          >
            + Add a slot
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            A sign-up sheet can have up to {SIGNUP_SLOTS_MAX} slots.
          </p>
        )}
      </fieldset>

      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      <FormFooter layout={layout} onCancel={onDiscard} cancelDisabled={posting}>
        <Button
          type="submit"
          size={primarySize(layout)}
          disabled={!check.ok || posting}
        >
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {posting ? "Posting…" : "Post sign-up"}
        </Button>
      </FormFooter>
    </form>
  );
}

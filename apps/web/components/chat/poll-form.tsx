"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { buildPollMessage, type PollPayload } from "@repo/chat-core/polls";
import {
  addPollOption,
  canAddPollOption,
  canRemovePollOption,
  checkPollDraft,
  closesAtFor,
  movePollOption,
  pollCloseChoicesFor,
  POLL_MULTIPLE_LABEL,
  removePollOption,
  setPollOption,
  type PollCloseChoice,
  type PollDraft,
} from "@repo/chat-core/poll-draft";
import {
  POLL_OPTION_MAX_LENGTH,
  POLL_OPTIONS_MAX,
  POLL_QUESTION_MAX_LENGTH,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FormFooter,
  fieldClass,
  primarySize,
  useReportDraft,
} from "@/components/shared/short-form";

/**
 * The composer's New poll form (#3865, #3773 step 2), inside the + card
 * (#3983): opened from the card's Poll row, or by `/poll` typed bare or
 * unfinished, and filled in with what was typed. It is the web twin of
 * mobile's New poll sheet (`apps/mobile/components/chat/new-poll-sheet.tsx`):
 * the same draft model (`@repo/chat-core/poll-draft`), the same rules for a
 * postable poll, and the same card (`buildPollMessage`), so a poll made here
 * is the one `/poll` and the phone post.
 *
 * A question, two to ten options (add, remove, move up or down), and when
 * voting closes, a day by default as `/poll` does, or **Doesn't close**
 * (#3896) for a poll its creator ends from the card, and whether a member
 * may pick more than one option (#3793). Posting goes through the
 * outbox like a message, so it works offline and a server refusal lands on
 * the card's own failed row with Retry and Discard. What this form reports
 * itself is only an outbox that refused the row, when the draft is all the
 * member has.
 */
export interface PollFormProps {
  /** What the form opens on: empty, read from a typed `/poll`, or kept. */
  initialDraft: PollDraft;
  onDraftChange?: (draft: PollDraft) => void;
  /** Queues the card in the channel the form was opened in. Never rejects. */
  onPost: (poll: {
    content: string;
    payload: PollPayload;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Whether this member could end the poll from its card (they hold
   * `polls:create`): only then is **Doesn't close** offered, so nobody posts
   * a poll they can't close. `false` while that isn't known.
   */
  canCloseEarly: boolean;
  onDone: () => void;
  onDiscard: () => void;
  /** Injected so the close time is deterministic under test. */
  now?: () => Date;
}

export function PollForm({
  initialDraft,
  onDraftChange,
  onPost,
  canCloseEarly,
  onDone,
  onDiscard,
  now,
}: PollFormProps) {
  const layout = "card";
  const field = fieldClass(layout);
  const [draft, setDraft] = useState<PollDraft>(initialDraft);
  useReportDraft(draft, onDraftChange);
  const [failure, setFailure] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  // Set the moment Post is pressed, before `posting` reaches a render, so a
  // second click in the same batch can't queue the poll twice.
  const sending = useRef(false);

  const check = useMemo(() => checkPollDraft(draft), [draft]);
  const problem = failure ?? (check.ok ? null : check.problem);

  const edit = useCallback((next: (current: PollDraft) => PollDraft) => {
    setDraft(next);
    setFailure(null);
  }, []);

  const post = useCallback(() => {
    if (!check.ok || sending.current) return;
    sending.current = true;
    setPosting(true);
    setFailure(null);
    const poll = buildPollMessage({
      question: check.question,
      options: check.options,
      closesAt: closesAtFor(draft.closes, now ? now() : new Date()),
      multiple: draft.multiple,
    });
    void onPost(poll)
      .catch(
        (): { ok: false; error: string } => ({
          ok: false,
          error: "Couldn't post that poll. Try again.",
        }),
      )
      .then((result) => {
        sending.current = false;
        setPosting(false);
        if (result.ok) {
          onDone();
          return;
        }
        setFailure(result.error);
      });
  }, [check, draft.closes, draft.multiple, now, onPost, onDone]);

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
            <span className="text-muted-foreground">Question</span>
            <Textarea
              rows={2}
              value={draft.question}
              onChange={(event) =>
                edit((current) => ({
                  ...current,
                  question: event.target.value,
                }))
              }
              placeholder="Ask a question"
              maxLength={POLL_QUESTION_MAX_LENGTH}
              disabled={posting}
              data-plus-autofocus
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm text-muted-foreground">
              Options
            </legend>
            {draft.options.map((option, index) => (
              // The row's own key, not its position: a moved row takes its
              // field, and the caret in it, along (`PollOptionRow`).
              <div key={option.key} className="flex items-center gap-1">
                <Input
                  value={option.text}
                  onChange={(event) =>
                    edit((current) =>
                      setPollOption(current, option.key, event.target.value),
                    )
                  }
                  placeholder={`Option ${index + 1}`}
                  aria-label={`Option ${index + 1}`}
                  maxLength={POLL_OPTION_MAX_LENGTH}
                  className={field}
                  disabled={posting}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={`Move option ${index + 1} up`}
                  disabled={posting || index === 0}
                  onClick={() =>
                    edit((current) => movePollOption(current, option.key, -1))
                  }
                >
                  <span aria-hidden="true">↑</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={`Move option ${index + 1} down`}
                  disabled={posting || index === draft.options.length - 1}
                  onClick={() =>
                    edit((current) => movePollOption(current, option.key, 1))
                  }
                >
                  <span aria-hidden="true">↓</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={`Remove option ${index + 1}`}
                  disabled={posting || !canRemovePollOption(draft)}
                  onClick={() =>
                    edit((current) => removePollOption(current, option.key))
                  }
                >
                  <span aria-hidden="true">×</span>
                </Button>
              </div>
            ))}
            {canAddPollOption(draft) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={posting}
                onClick={() => edit(addPollOption)}
              >
                + Add option
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                A poll can have up to {POLL_OPTIONS_MAX} options.
              </p>
            )}
          </fieldset>

          <div className="space-y-1 text-sm">
            <Label
              htmlFor="new-poll-closes"
              className="font-normal text-muted-foreground"
            >
              Voting closes in
            </Label>
            <Select
              value={draft.closes}
              onValueChange={(value) =>
                edit((current) => ({
                  ...current,
                  closes: value as PollCloseChoice,
                }))
              }
              disabled={posting}
            >
              <SelectTrigger id="new-poll-closes" className={field}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pollCloseChoicesFor(canCloseEarly).map((choice) => (
                  <SelectItem key={choice.id} value={choice.id}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="new-poll-multiple">{POLL_MULTIPLE_LABEL}</Label>
            <Switch
              id="new-poll-multiple"
              checked={draft.multiple}
              disabled={posting}
              onCheckedChange={(multiple) =>
                edit((current) => ({ ...current, multiple }))
              }
            />
          </div>

          {problem ? (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          ) : null}

          <FormFooter
            layout={layout}
            onCancel={onDiscard}
            cancelDisabled={posting}
          >
            <Button
              type="submit"
              size={primarySize(layout)}
              disabled={!check.ok || posting}
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {posting ? "Posting…" : "Post poll"}
            </Button>
          </FormFooter>
        </form>
  );
}

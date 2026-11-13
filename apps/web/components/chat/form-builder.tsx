"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, X } from "lucide-react";
import {
  FORM_END_PASSED_PROBLEM,
  FORM_QUESTION_TYPE_CHOICES,
  addFormOption,
  addFormQuestion,
  canAddFormOption,
  canAddFormQuestion,
  canRemoveFormOption,
  canRemoveFormQuestion,
  checkFormDraft,
  moveFormQuestion,
  removeFormOption,
  removeFormQuestion,
  setFormOption,
  setFormQuestion,
  type FormDraft,
  type FormQuestionRow,
} from "@repo/chat-core/form-draft";
import {
  buildFormMessage,
  isChoiceQuestion,
  type FormPayload,
  type FormQuestionType,
} from "@repo/chat-core/forms";
import {
  FORM_DESCRIPTION_MAX_LENGTH,
  FORM_OPTION_LABEL_MAX_LENGTH,
  FORM_OPTIONS_MAX,
  FORM_QUESTION_TITLE_MAX_LENGTH,
  FORM_QUESTIONS_MAX,
  FORM_TITLE_MAX_LENGTH,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  FormFooter,
  fieldClass,
  primarySize,
  useReportDraft,
} from "@/components/shared/short-form";
import { cn } from "@/lib/utils";
import { EndTimeField } from "./signup-form";

/**
 * The composer's New form builder (#3926 step 3), inside the + card: a
 * title, optional details, and an ordered list of questions, each one of six
 * types (short answer, paragraph, multiple choice, checkboxes, dropdown, yes
 * or no) and optionally required, as Google Forms and Microsoft Forms build
 * one. It may close at a set time. One draft model and one card builder with
 * the phone (`@repo/chat-core/form-draft`, `buildFormMessage`). Posting goes
 * through the outbox like a sign-up sheet, so it works offline and a server
 * refusal lands on the card's own failed row; this form reports only an
 * outbox that refused it.
 */
export interface FormBuilderProps {
  initialDraft: FormDraft;
  onDraftChange?: (draft: FormDraft) => void;
  /** Queues the card in the channel the builder was opened in. Never rejects. */
  onPost: (form: {
    content: string;
    payload: FormPayload;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDone: () => void;
  onDiscard: () => void;
}

export function FormBuilder({
  initialDraft,
  onDraftChange,
  onPost,
  onDone,
  onDiscard,
}: FormBuilderProps) {
  const layout = "card";
  const field = fieldClass(layout);
  const [draft, setDraft] = useState<FormDraft>(initialDraft);
  useReportDraft(draft, onDraftChange);
  const [failure, setFailure] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const sending = useRef(false);

  const check = useMemo(() => checkFormDraft(draft), [draft]);
  const problem = failure ?? (check.ok ? null : check.problem);
  const problemQuestion = !failure && !check.ok ? check.questionKey : undefined;

  const edit = useCallback((next: (current: FormDraft) => FormDraft) => {
    setDraft(next);
    setFailure(null);
  }, []);

  const post = useCallback(() => {
    if (!check.ok || sending.current) return;
    // Checked again now: an end time can pass while the builder sits open.
    const fresh = checkFormDraft(draft);
    if (!fresh.ok) {
      setFailure(fresh.problem ?? FORM_END_PASSED_PROBLEM);
      return;
    }
    sending.current = true;
    setPosting(true);
    setFailure(null);
    void onPost(buildFormMessage(fresh.input))
      .catch((): { ok: false; error: string } => ({
        ok: false,
        error: "Couldn't post that form. Try again.",
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
  }, [check, draft, onPost, onDone]);

  const count = draft.questions.length;

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
          placeholder="Formal housing"
          maxLength={FORM_TITLE_MAX_LENGTH}
          className={field}
          disabled={posting}
          data-plus-autofocus
        />
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Details (optional)</span>
        <Textarea
          rows={2}
          value={draft.description}
          onChange={(event) =>
            edit((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          placeholder="What it's for, and when you need answers by"
          maxLength={FORM_DESCRIPTION_MAX_LENGTH}
          disabled={posting}
        />
      </label>

      <ol className="space-y-3" aria-label="Questions">
        {draft.questions.map((question, index) => (
          <QuestionEditor
            key={question.key}
            question={question}
            index={index}
            count={count}
            invalid={problemQuestion === question.key}
            disabled={posting}
            canRemove={canRemoveFormQuestion(draft)}
            onType={(type) =>
              edit((current) =>
                setFormQuestion(current, question.key, { type }),
              )
            }
            onTitle={(title) =>
              edit((current) =>
                setFormQuestion(current, question.key, { title }),
              )
            }
            onRequired={(required) =>
              edit((current) =>
                setFormQuestion(current, question.key, { required }),
              )
            }
            onMove={(by) =>
              edit((current) => moveFormQuestion(current, question.key, by))
            }
            onRemove={() =>
              edit((current) => removeFormQuestion(current, question.key))
            }
            onOption={(optionKey, label) =>
              edit((current) =>
                setFormOption(current, question.key, optionKey, label),
              )
            }
            onAddOption={() =>
              edit((current) => addFormOption(current, question.key))
            }
            onRemoveOption={(optionKey) =>
              edit((current) =>
                removeFormOption(current, question.key, optionKey),
              )
            }
          />
        ))}
      </ol>
      {canAddFormQuestion(draft) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          disabled={posting}
          onClick={() => edit(addFormQuestion)}
        >
          + Add a question
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          A form can have up to {FORM_QUESTIONS_MAX} questions.
        </p>
      )}

      <EndTimeField
        id="new-form-ends"
        label="Closes at a set time"
        value={draft.closesAt}
        disabled={posting}
        onChange={(closesAt) => edit((current) => ({ ...current, closesAt }))}
      />

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
          {posting ? "Posting…" : "Post form"}
        </Button>
      </FormFooter>
    </form>
  );
}

function QuestionEditor({
  question,
  index,
  count,
  invalid,
  disabled,
  canRemove,
  onType,
  onTitle,
  onRequired,
  onMove,
  onRemove,
  onOption,
  onAddOption,
  onRemoveOption,
}: {
  question: FormQuestionRow;
  index: number;
  count: number;
  invalid: boolean;
  disabled: boolean;
  canRemove: boolean;
  onType: (type: FormQuestionType) => void;
  onTitle: (title: string) => void;
  onRequired: (required: boolean) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onOption: (optionKey: string, label: string) => void;
  onAddOption: () => void;
  onRemoveOption: (optionKey: string) => void;
}) {
  const n = index + 1;
  const requiredId = `${question.key}-required`;
  return (
    <li
      className={cn(
        "space-y-2 rounded-md border border-border p-2",
        invalid && "border-destructive",
      )}
    >
      <div className="flex items-center gap-1">
        <span className="text-caption text-muted-foreground">Question {n}</span>
        <div className="ml-auto flex items-center">
          <IconButton
            type="button"
            label={`Move question ${n} up`}
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            label={`Move question ${n} down`}
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            label={`Remove question ${n}`}
            disabled={disabled || !canRemove}
            onClick={onRemove}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <Input
        value={question.title}
        onChange={(event) => onTitle(event.target.value)}
        placeholder={n === 1 ? "What room do you want?" : "Question"}
        aria-label={`Question ${n}`}
        aria-invalid={invalid || undefined}
        maxLength={FORM_QUESTION_TITLE_MAX_LENGTH}
        className="h-9"
        disabled={disabled}
      />
      <Select
        value={question.type}
        onValueChange={(next) => onType(next as FormQuestionType)}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label={`Question ${n} type`}
          className="h-9 pointer-coarse:h-11"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FORM_QUESTION_TYPE_CHOICES.map((choice) => (
            <SelectItem key={choice.id} value={choice.id}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isChoiceQuestion(question.type) ? (
        <fieldset className="space-y-1">
          <legend className="sr-only">Question {n} options</legend>
          {question.options.map((option, optionIndex) => (
            <div key={option.key} className="flex items-center gap-1">
              <Input
                value={option.label}
                onChange={(event) => onOption(option.key, event.target.value)}
                placeholder={`Option ${optionIndex + 1}`}
                aria-label={`Question ${n}, option ${optionIndex + 1}`}
                maxLength={FORM_OPTION_LABEL_MAX_LENGTH}
                className="h-9 min-w-0 flex-1"
                disabled={disabled}
              />
              <IconButton
                type="button"
                label={`Remove question ${n}, option ${optionIndex + 1}`}
                disabled={disabled || !canRemoveFormOption(question)}
                onClick={() => onRemoveOption(option.key)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </div>
          ))}
          {canAddFormOption(question) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={onAddOption}
            >
              + Add an option
            </Button>
          ) : (
            <p className="text-caption text-muted-foreground">
              Up to {FORM_OPTIONS_MAX} options.
            </p>
          )}
        </fieldset>
      ) : question.type === "yes_no" ? (
        <p className="text-caption text-muted-foreground">
          Members answer Yes or No.
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-4 text-sm">
        <label htmlFor={requiredId} className="text-muted-foreground">
          Required
        </label>
        <Switch
          id={requiredId}
          checked={question.required}
          disabled={disabled}
          onCheckedChange={onRequired}
        />
      </div>
    </li>
  );
}

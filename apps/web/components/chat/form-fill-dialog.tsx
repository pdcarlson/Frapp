"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  FORM_NO,
  FORM_YES,
  fetchOwnFormResponse,
  formAnswerProblems,
  formAnswersForSave,
  formDeadlineLine,
  formResponseKey,
  isFormClosed,
  readFormPayload,
  saveFormResponse,
  type FormAnswers,
  type FormPayload,
  type FormQuestion,
} from "@repo/chat-core/forms";
import type { ChatMessage } from "@repo/chat-core/types";
import { useFrappClient, useNow } from "@repo/hooks";
import {
  FORM_PARAGRAPH_ANSWER_MAX_LENGTH,
  FORM_SHORT_ANSWER_MAX_LENGTH,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/short-form";
import { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * The full-page form a form card opens (#3926 step 3): every question, the
 * viewer's own answers, and Send. Like Slack's workflow forms, it opens over
 * chat rather than on a page of its own, so a member comes back to the
 * conversation they left; like Google Forms and Microsoft Forms, it is one
 * scrolling page of questions with required ones starred and checked before
 * sending.
 *
 * Answers are private (`@repo/chat-core/forms`): they are read and saved
 * through the form-response route, never the card, and a member may change
 * theirs until the form closes. A closed form shows them read-only.
 *
 * Hosted once by the chat shell ({@link FormFillHost}), not by the card, so a
 * timeline that scrolls the card out of its window while a member is typing
 * can't take the form down with it.
 */

const FormFillContext = createContext<((message: ChatMessage) => void) | null>(
  null,
);

/**
 * How a form card opens its form: the host's opener, or `null` outside one
 * (a surface that draws a card without the chat shell), where the card opens
 * its own.
 */
export function useOpenForm(): ((message: ChatMessage) => void) | null {
  return useContext(FormFillContext);
}

export function FormFillHost({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<ChatMessage | null>(null);
  return (
    <FormFillContext.Provider value={setMessage}>
      {children}
      <FormFillDialog
        message={message}
        onOpenChange={(open) => {
          if (!open) setMessage(null);
        }}
      />
    </FormFillContext.Provider>
  );
}

export function FormFillDialog({
  message,
  onOpenChange,
}: {
  /** The form card to fill, or `null` while none is open. */
  message: ChatMessage | null;
  onOpenChange: (open: boolean) => void;
}) {
  const payload = useMemo(
    () => (message ? readFormPayload(message) : null),
    [message],
  );
  return (
    <Dialog open={!!message && !!payload} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(100dvh,56rem)] max-h-[100dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0 max-sm:rounded-none">
        {message && payload ? (
          <FormFillBody
            key={message.id}
            messageId={message.id}
            payload={payload}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FormFillBody({
  messageId,
  payload,
  onDone,
}: {
  messageId: string;
  payload: FormPayload;
  onDone: () => void;
}) {
  const apiClient = useFrappClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const now = useNow();
  const closed = isFormClosed(payload, now);
  const deadline = formDeadlineLine(payload, now);

  const response = useQuery({
    queryKey: formResponseKey(messageId),
    queryFn: () => fetchOwnFormResponse(apiClient, messageId),
  });
  // The member's edits, or `null` before their first: until then the form
  // shows the answers they last sent.
  const [edited, setEdited] = useState<FormAnswers | null>(null);
  const saved = response.data?.answers;

  const [showProblems, setShowProblems] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const current = useMemo(() => edited ?? saved ?? {}, [edited, saved]);
  const problems = useMemo(
    () => formAnswerProblems(payload.questions, current),
    [payload.questions, current],
  );
  const problemCount = Object.keys(problems).length;
  const answered = !!response.data;

  const setAnswer = useCallback(
    (questionId: string, value: string | string[] | undefined) => {
      setFailure(null);
      setEdited((prev) => {
        const next = { ...(prev ?? saved ?? {}) };
        if (value === undefined) delete next[questionId];
        else next[questionId] = value;
        return next;
      });
    },
    [saved],
  );

  const send = async () => {
    if (closed || sending || !response.isSuccess) return;
    if (problemCount > 0) {
      setShowProblems(true);
      return;
    }
    setSending(true);
    setFailure(null);
    try {
      const saved = await saveFormResponse(
        apiClient,
        messageId,
        formAnswersForSave(payload.questions, current),
      );
      queryClient.setQueryData(formResponseKey(messageId), saved);
      toast({ title: answered ? "Answers updated" : "Answers sent" });
      onDone();
    } catch (cause) {
      setFailure(
        cause instanceof Error ? cause.message : "Couldn't send your answers",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
        <p className="text-caption text-muted-foreground">
          Form{deadline ? ` · ${deadline}` : ""}
        </p>
        <DialogTitle className="mt-1 pr-8 text-title font-bold">
          {payload.title}
        </DialogTitle>
        {payload.description ? (
          <DialogDescription className="mt-2 whitespace-pre-wrap">
            {payload.description}
          </DialogDescription>
        ) : (
          <DialogDescription className="sr-only">
            {closed
              ? "This form is closed. Your answers are shown below."
              : "Answer the questions below, then send."}
          </DialogDescription>
        )}
        <p className="mt-3 text-caption text-muted-foreground">
          {closed
            ? answered
              ? "This form is closed. These are the answers you sent."
              : "This form is closed. You didn't answer it."
            : "Only you and the person who posted this form see your answers."}
        </p>

        {response.isPending ? (
          <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your answers…
          </div>
        ) : response.isError ? (
          <div className="mt-8 space-y-2 text-sm">
            <p role="alert" className="text-destructive-text">
              {response.error.message}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void response.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <ol className="mt-6 space-y-6">
            {payload.questions.map((question, index) => (
              <QuestionField
                key={question.id}
                index={index}
                question={question}
                value={current[question.id]}
                onChange={(value) => setAnswer(question.id, value)}
                readOnly={closed || sending}
                problem={showProblems ? problems[question.id] : undefined}
              />
            ))}
          </ol>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-6 py-4">
        {failure ? (
          <p role="alert" className="mr-auto text-sm text-destructive-text">
            {failure}
          </p>
        ) : showProblems && problemCount > 0 ? (
          <p role="alert" className="mr-auto text-sm text-destructive-text">
            {problemCount === 1
              ? "One question needs an answer."
              : `${problemCount} questions need an answer.`}
          </p>
        ) : null}
        <Button type="button" variant="ghost" onClick={onDone}>
          {closed ? "Done" : "Cancel"}
        </Button>
        {closed ? null : (
          <Button type="submit" disabled={sending || !response.isSuccess}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {sending ? "Sending…" : answered ? "Update answers" : "Send"}
          </Button>
        )}
      </div>
    </form>
  );
}

function QuestionField({
  index,
  question,
  value,
  onChange,
  readOnly,
  problem,
}: {
  index: number;
  question: FormQuestion;
  value: string | string[] | undefined;
  onChange: (value: string | string[] | undefined) => void;
  readOnly: boolean;
  problem: string | undefined;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const invalid = problem ? true : undefined;
  const describedBy = problem ? errorId : undefined;
  const text = typeof value === "string" ? value : "";
  const picked = Array.isArray(value) ? value : [];

  let control: ReactNode;
  switch (question.type) {
    case "short_answer":
      control = (
        <Input
          id={id}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          maxLength={FORM_SHORT_ANSWER_MAX_LENGTH}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          readOnly={readOnly}
          placeholder="Your answer"
        />
      );
      break;
    case "paragraph":
      control = (
        <Textarea
          id={id}
          rows={4}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          maxLength={FORM_PARAGRAPH_ANSWER_MAX_LENGTH}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          readOnly={readOnly}
          placeholder="Your answer"
        />
      );
      break;
    case "dropdown":
      control = (
        <Select
          value={text || undefined}
          onValueChange={(next) => onChange(next)}
          disabled={readOnly}
        >
          <SelectTrigger
            id={id}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="max-w-sm"
          >
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {(question.options ?? []).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "multiple_choice":
    case "yes_no":
    case "checkboxes": {
      const options =
        question.type === "yes_no"
          ? [
              { id: FORM_YES, label: "Yes" },
              { id: FORM_NO, label: "No" },
            ]
          : (question.options ?? []);
      const many = question.type === "checkboxes";
      control = (
        <div
          role={many ? "group" : "radiogroup"}
          aria-labelledby={labelId}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="flex flex-col"
        >
          {options.map((option) => {
            const checked = many
              ? picked.includes(option.id)
              : text === option.id;
            return (
              <label
                key={option.id}
                className={cn(
                  "flex min-h-9 items-center gap-3 rounded-md px-2 text-sm pointer-coarse:min-h-11",
                  readOnly
                    ? "cursor-default"
                    : "cursor-pointer hover:bg-card-hover",
                )}
              >
                <input
                  type={many ? "checkbox" : "radio"}
                  name={id}
                  value={option.id}
                  checked={checked}
                  disabled={readOnly && !checked}
                  onChange={() => {
                    if (readOnly) return;
                    if (!many) {
                      onChange(option.id);
                      return;
                    }
                    const next = checked
                      ? picked.filter((each) => each !== option.id)
                      : [...picked, option.id];
                    onChange(next.length > 0 ? next : undefined);
                  }}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 break-words">{option.label}</span>
              </label>
            );
          })}
          {!many && !readOnly && text && !question.required ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto self-start px-2"
              onClick={() => onChange(undefined)}
            >
              Clear selection
            </Button>
          ) : null}
        </div>
      );
      break;
    }
  }

  const textual =
    question.type === "short_answer" ||
    question.type === "paragraph" ||
    question.type === "dropdown";
  return (
    <li className="space-y-2">
      {textual ? (
        <label
          id={labelId}
          htmlFor={id}
          className="block text-base font-medium"
        >
          <QuestionTitle index={index} question={question} />
        </label>
      ) : (
        <p id={labelId} className="text-base font-medium">
          <QuestionTitle index={index} question={question} />
        </p>
      )}
      {control}
      {problem ? <FieldError id={errorId}>{problem}</FieldError> : null}
    </li>
  );
}

function QuestionTitle({
  index,
  question,
}: {
  index: number;
  question: FormQuestion;
}) {
  return (
    <>
      <span className="sr-only">Question {index + 1}: </span>
      {question.title}
      {question.required ? (
        <>
          <span aria-hidden="true" className="ml-1 text-destructive-text">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </>
  );
}

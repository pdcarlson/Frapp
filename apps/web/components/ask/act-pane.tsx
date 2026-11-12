"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, X } from "lucide-react";
import {
  errorCopy,
  useAcceptAiSuggestion,
  useActEventAudience,
  useActRequest,
  useCurrentUser,
  useDismissAiSuggestion,
  useMembers,
  type ActResponse,
  type AiSuggestion,
  type PointsSuggestionEdits,
  type TaskSuggestionEdits,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { codeOf } from "@repo/api-sdk";
import { dueEntryFields, dueEntryFromTask } from "@repo/formatting";
import {
  ACT_COPY,
  ACT_REQUEST_MAX_LENGTH,
  actActionLabel,
  actMissingLine,
  actNoteLine,
  actPointsDoneLine,
  actAttendanceLine,
  actConfirmRefusalLine,
  actPointsHeadline,
  actPointsTotalLine,
  actUnavailableLine,
  actWhenLine,
} from "@repo/validation";
import { ReportAiButton } from "@/components/ai/report-ai";
import { PanelBody } from "@/components/shared/panel";
import { DueDateField } from "@/components/tasks/due-date-field";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EYEBROW } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/**
 * The Do side of Ask on web (#718, `spec/behavior/ai.md` § Asking Frapp to do
 * something): an officer says what to do, and gets back a card that says
 * exactly what would happen. Nothing changes until they press Confirm.
 *
 * **A card to confirm, in the panel that already answers.** Slack's
 * `/remind` and Linear's "create issue from text" both answer a typed request
 * with the thing filled in for the person to check, and Notion AI shows what
 * it would change before it changes it. The card here is that: the action as
 * a title, each detail on its own line, the size of a bulk change in words
 * ("Give 5 points to 42 members"), and Confirm beside Cancel.
 *
 * **What can be fixed on the card is what a request leaves unsaid.** Who a
 * points change is for (take a member off, add one a name did not find), and
 * who and when for a task. Everything else is asked again in other words:
 * the field stays under the card.
 *
 * **Nothing above moves while it works.** The request sits where it was
 * typed, and one line under it says it is being worked out; the card takes
 * that line's place.
 */

type Turn =
  | { phase: "working"; request: string }
  | { phase: "failed"; request: string; message: string }
  | { phase: "answered"; request: string; response: ActResponse }
  | {
      phase: "done";
      request: string;
      line: string;
      link: { href: string; label: string } | null;
    }
  | { phase: "cancelled"; request: string };

type Member = NonNullable<ReturnType<typeof useMembers>["data"]>[number];

/**
 * What the Do side is showing. The panel holds it (not this pane), so a
 * waiting card is still there after a look at the Ask side or a close and
 * reopen, the way a finished answer is.
 */
export function useActSession() {
  const [turn, setTurn] = useState<Turn | null>(null);
  // Only the latest request may write the answer: one sent, then replaced
  // before it came back, is dropped.
  const latestRef = useRef(0);
  return { turn, setTurn, latestRef };
}
export type ActSession = ReturnType<typeof useActSession>;

export function ActPane({
  actions,
  ensureConsent,
  onLeave,
  session,
}: {
  /** Held by the panel so the card outlives this pane; its own when absent. */
  session?: ActSession;
  /** The actions this member can ask for (`GET /v1/ai/act`). */
  actions: readonly string[];
  /** The AI sheet's gate: asked before the first request leaves. */
  ensureConsent: () => Promise<boolean>;
  /** A link out of the panel was followed. */
  onLeave?: () => void;
}) {
  const request = useActRequest();
  const audience = useActEventAudience();
  const [draft, setDraft] = useState("");
  const own = useActSession();
  const { turn, setTurn, latestRef } = session ?? own;
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);

  const working = turn?.phase === "working";

  async function settle(said: string, run: () => Promise<ActResponse>) {
    const mine = ++latestRef.current;
    setTurn({ phase: "working", request: said });
    try {
      const agreed = await ensureConsent();
      const response: ActResponse = agreed
        ? await run()
        : {
            status: "unavailable",
            action: null,
            suggestion: null,
            notes: [],
            event_choice: null,
            missing: null,
            reason: "consent_required",
            available_actions: [],
          };
      if (mine === latestRef.current) {
        setTurn({ phase: "answered", request: said, response });
      }
    } catch (error) {
      if (mine === latestRef.current) {
        setTurn({
          phase: "failed",
          request: said,
          message: errorCopy(error, ACT_COPY.failed),
        });
      }
    }
  }

  function submit(text: string) {
    const said = text.trim();
    if (!said || working) return;
    setDraft("");
    void settle(said, () => request.mutateAsync(said));
  }

  const examples = actions.flatMap((action) => {
    const example = (ACT_COPY.examples as Record<string, string>)[action];
    return example ? [example] : [];
  });

  return (
    <>
      <PanelBody>
        {turn ? (
          <article className="space-y-3">
            <h3 className="rounded-md bg-surface-1 px-3 py-2 text-sm font-medium text-foreground">
              {turn.request}
            </h3>
            <div aria-live="polite" className="space-y-3">
              {turn.phase === "working" ? (
                <p className="text-caption text-muted-foreground">
                  {ACT_COPY.working}
                </p>
              ) : null}
              {turn.phase === "failed" ? (
                <div className="space-y-2">
                  <p className="text-sm text-foreground">{turn.message}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => submit(turn.request)}
                  >
                    {ACT_COPY.try_again}
                  </Button>
                </div>
              ) : null}
              {turn.phase === "cancelled" ? (
                <p className="text-sm text-muted-foreground">
                  {ACT_COPY.cancelled}
                </p>
              ) : null}
              {turn.phase === "done" ? (
                <div className="space-y-2">
                  <p className="text-sm text-foreground">{turn.line}</p>
                  {turn.link ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={turn.link.href} onClick={onLeave}>
                        {turn.link.label}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {turn.phase === "answered" ? (
                <ActAnswer
                  response={turn.response}
                  onAnswerConsent={() => submit(turn.request)}
                  onPickEvent={(eventId) => {
                    const choice = turn.response.event_choice;
                    if (!choice) return;
                    void settle(turn.request, () =>
                      audience.mutateAsync({
                        eventId,
                        amount: choice.amount,
                        reason: choice.reason,
                      }),
                    );
                  }}
                  onDone={(line, link) =>
                    setTurn({
                      phase: "done",
                      request: turn.request,
                      line,
                      link,
                    })
                  }
                  onCancelled={() =>
                    setTurn({ phase: "cancelled", request: turn.request })
                  }
                />
              ) : null}
            </div>
          </article>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                {ACT_COPY.empty_title}
              </p>
              <p className="text-sm text-muted-foreground">
                {ACT_COPY.empty_body}
              </p>
            </div>
            <ul className="space-y-1.5">
              {examples.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    onClick={() => submit(example)}
                    className={cn(
                      "w-full rounded-md border border-border px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-card-hover",
                      FOCUS_RING,
                    )}
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PanelBody>
      <form
        className="shrink-0 space-y-2 border-t border-border px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            ref={field}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit(draft);
              }
            }}
            rows={2}
            maxLength={ACT_REQUEST_MAX_LENGTH}
            placeholder={ACT_COPY.placeholder}
            aria-label={ACT_COPY.placeholder}
            className="min-h-[64px] resize-none"
          />
          <Button
            type="submit"
            size="icon"
            className="shrink-0"
            aria-label={ACT_COPY.send}
            title={ACT_COPY.send}
            disabled={working || draft.trim().length === 0}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="min-h-9 text-caption text-muted-foreground">
          {ACT_COPY.footnote}
        </p>
      </form>
    </>
  );
}

function ActAnswer({
  response,
  onAnswerConsent,
  onPickEvent,
  onDone,
  onCancelled,
}: {
  response: ActResponse;
  onAnswerConsent: () => void;
  onPickEvent: (eventId: string) => void;
  onDone: (line: string, link: { href: string; label: string } | null) => void;
  onCancelled: () => void;
}) {
  if (response.status === "proposed" && response.suggestion) {
    return (
      <ActCard
        suggestion={response.suggestion}
        notes={response.notes}
        onDone={onDone}
        onCancelled={onCancelled}
      />
    );
  }
  if (response.status === "needs_event" && response.event_choice) {
    const { events } = response.event_choice;
    if (events.length === 0) {
      return (
        <p className="text-sm text-foreground">{ACT_COPY.no_recent_events}</p>
      );
    }
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">
          {ACT_COPY.pick_event}
        </p>
        <ul className="space-y-1.5">
          {events.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => onPickEvent(event.id)}
                className={cn(
                  "w-full rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-card-hover",
                  FOCUS_RING,
                )}
              >
                <span className="block text-sm font-medium text-foreground">
                  {event.name}
                </span>
                <span className="block text-caption text-muted-foreground">
                  {actWhenLine(event.start_time, "")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (response.status === "unavailable") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-foreground">
          {actUnavailableLine(response.reason)}
        </p>
        {response.reason === "consent_required" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onAnswerConsent}
          >
            {ACT_COPY.consent_action}
          </Button>
        ) : null}
      </div>
    );
  }
  if (response.status === "refused") {
    return <p className="text-sm text-foreground">{ACT_COPY.refused}</p>;
  }
  if (response.status === "no_action") {
    const labels = response.available_actions.flatMap((action) => {
      const label = actActionLabel(action);
      return label ? [label] : [];
    });
    return (
      <div className="space-y-2">
        <p className="text-sm text-foreground">{ACT_COPY.no_action}</p>
        {labels.length > 0 ? (
          <div className="text-sm text-muted-foreground">
            <p>{ACT_COPY.no_action_can}</p>
            <ul className="list-disc pl-5">
              {labels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }
  // `unclear`, and any status a newer server sends.
  return (
    <p className="text-sm text-foreground">
      {actMissingLine(response.missing)}
    </p>
  );
}

/** Why a Confirm or Cancel was refused, in words an officer can act on. */
function refusalLine(error: unknown): string {
  switch (codeOf(error)) {
    case "ai.suggestion.decided":
    case "ai.suggestion.expired":
    case "ai.suggestion.not_found":
      return ACT_COPY.gone;
    default:
      return (
        actConfirmRefusalLine(codeOf(error) ?? null) ??
        errorCopy(error, ACT_COPY.failed)
      );
  }
}

function CardRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className={cn(EYEBROW, "text-muted-foreground")}>{label}</dt>
      <dd className="break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

function ActCard({
  suggestion,
  notes,
  onDone,
  onCancelled,
}: {
  suggestion: AiSuggestion;
  notes: ActResponse["notes"];
  onDone: (line: string, link: { href: string; label: string } | null) => void;
  onCancelled: () => void;
}) {
  const accept = useAcceptAiSuggestion();
  const dismiss = useDismissAiSuggestion();
  const membersQuery = useMembers();
  const me = (useCurrentUser().data as { id?: string } | undefined)?.id ?? null;
  const members = useMemo(
    () => (membersQuery.data ?? []).filter((member) => member.user_id),
    [membersQuery.data],
  );
  const nameOf = (userId: string) => {
    const member = members.find((row) => row.user_id === userId);
    return member
      ? memberLabel(member.display_name, member.user_id)
      : membersQuery.isSuccess
        ? ACT_COPY.former_member
        : "";
  };

  const { points, task, event } = suggestion;
  const [targets, setTargets] = useState<string[]>(
    points?.target_user_ids ?? [],
  );
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? "");
  const [due, setDue] = useState(
    task?.due_date
      ? dueEntryFromTask({ due_date: task.due_date, due_at: task.due_at })
      : "",
  );
  const [showMembers, setShowMembers] = useState(false);
  // Confirm pressed with something still missing: say which, on the card.
  const [flagged, setFlagged] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = accept.isPending || dismiss.isPending;

  const noteLines = notes.flatMap((note) => {
    const line = actNoteLine({
      type: note.type,
      name: note.name ?? null,
      count: note.count ?? null,
      matched:
        note.type === "matched_name" && note.user_ids?.[0]
          ? nameOf(note.user_ids[0]) || null
          : null,
    });
    return line ? [line] : [];
  });

  async function confirm() {
    setProblem(null);
    let edits: { points?: PointsSuggestionEdits; task?: TaskSuggestionEdits } =
      {};
    if (points) {
      if (targets.length === 0) return setFlagged(true);
      const changed =
        targets.length !== points.target_user_ids.length ||
        targets.some((id) => !points.target_user_ids.includes(id));
      if (changed) edits = { points: { target_user_ids: targets } };
    }
    if (task) {
      if (!assigneeId || !due) return setFlagged(true);
      const changes: TaskSuggestionEdits = {};
      if (assigneeId !== (task.assignee_id ?? "")) {
        changes.assignee_id = assigneeId;
      }
      const fields = dueEntryFields(due);
      if (
        fields.due_date !== task.due_date ||
        (fields.due_at ?? null) !== (task.due_at ?? null)
      ) {
        changes.due_date = fields.due_date;
        changes.due_at = fields.due_at ?? null;
      }
      if (Object.keys(changes).length > 0) edits = { task: changes };
    }
    try {
      const decision = await accept.mutateAsync({
        id: suggestion.id,
        ...edits,
      });
      if (points) {
        const outcome = decision.result?.outcome;
        onDone(
          actPointsDoneLine(
            points.amount,
            outcome?.adjusted ?? targets.length,
            outcome?.skipped ?? 0,
          ),
          { href: "/points", label: ACT_COPY.open_points },
        );
      } else if (task) {
        onDone(ACT_COPY.done_task, {
          href: "/tasks",
          label: ACT_COPY.open_tasks,
        });
      } else {
        onDone(ACT_COPY.done_event, {
          href: "/events",
          label: ACT_COPY.open_events,
        });
      }
    } catch (error) {
      setProblem(refusalLine(error));
    }
  }

  async function cancel() {
    setProblem(null);
    try {
      await dismiss.mutateAsync(suggestion.id);
    } catch (error) {
      // Already gone is what Cancel wanted.
      if (
        !["ai.suggestion.not_found", "ai.suggestion.expired"].includes(
          codeOf(error) ?? "",
        )
      ) {
        setProblem(refusalLine(error));
        return;
      }
    }
    onCancelled();
  }

  const addable = members.filter(
    (member) =>
      member.user_id !== me && !targets.includes(String(member.user_id)),
  );

  let title: string = ACT_COPY.card_event_title;
  if (points) {
    title =
      points.amount < 0
        ? ACT_COPY.card_points_title_take
        : ACT_COPY.card_points_title_give;
  } else if (task) {
    title = ACT_COPY.card_task_title;
  }

  // Above the controls it points at ("Add them below").
  const notesStrip =
    noteLines.length > 0 ? (
      <ul className="space-y-1 rounded-md bg-surface-1 px-3 py-2 text-caption text-foreground">
        {noteLines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    ) : null;

  return (
    <section
      aria-label={title}
      className="space-y-3 rounded-[14px] border border-border p-3"
    >
      <div className="flex min-h-8 items-center justify-between gap-2">
        <p className={cn(EYEBROW, "text-muted-foreground")}>{title}</p>
        {/* Report this (#4315): what the agent proposed, for the Frapp team. */}
        <ReportAiButton
          iconOnly
          name={title}
          target={{ subject: "ai_suggestion", subjectId: suggestion.id }}
        />
      </div>

      {points ? (
        <>
          <div className="space-y-0.5">
            <p className="text-base font-semibold text-foreground">
              {actPointsHeadline(points.amount, targets.length)}
            </p>
            {/* One line high with or without it, so removing down to one member moves nothing. */}
            <p className="min-h-[18px] text-caption text-muted-foreground">
              {actPointsTotalLine(points.amount, targets.length)}
            </p>
          </div>
          <dl className="space-y-2">
            <CardRow label={ACT_COPY.field_reason}>{points.reason}</CardRow>
            {points.event_name ? (
              <CardRow label={ACT_COPY.field_attendance}>
                {actAttendanceLine(points.event_name, points.event_start_time)}
              </CardRow>
            ) : null}
          </dl>
          {notesStrip}
          <MemberList
            targets={targets}
            nameOf={nameOf}
            open={showMembers || targets.length <= 5}
            collapsible={targets.length > 5}
            onToggle={() => setShowMembers((shown) => !shown)}
            onRemove={(id) =>
              setTargets((list) => list.filter((other) => other !== id))
            }
            disabled={busy}
          />
          {addable.length > 0 ? (
            <AddMember
              members={addable}
              disabled={busy}
              onAdd={(id) => {
                setTargets((list) => [...list, id]);
                setFlagged(false);
              }}
            />
          ) : null}
          {flagged && targets.length === 0 ? (
            <p role="alert" className="text-caption text-destructive-text">
              {ACT_COPY.no_members}
            </p>
          ) : null}
        </>
      ) : null}

      {task ? (
        <>
          <p className="break-words text-base font-semibold text-foreground">
            {task.title}
          </p>
          {task.description ? (
            <p className="break-words text-sm text-muted-foreground">
              {task.description}
            </p>
          ) : null}
          {notesStrip}
          <div className="space-y-2">
            <div className="space-y-1">
              <p className={cn(EYEBROW, "text-muted-foreground")}>
                {ACT_COPY.field_for}
              </p>
              <Select
                value={assigneeId}
                onValueChange={setAssigneeId}
                disabled={busy}
              >
                <SelectTrigger
                  aria-label={ACT_COPY.field_for}
                  aria-invalid={(flagged && !assigneeId) || undefined}
                >
                  <SelectValue placeholder={ACT_COPY.pick_member} />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem
                      key={String(member.user_id)}
                      value={String(member.user_id)}
                    >
                      {memberLabel(member.display_name, member.user_id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {flagged && !assigneeId ? (
                <p
                  role="alert"
                  className="mt-1 text-caption text-destructive-text"
                >
                  {ACT_COPY.need_assignee}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <p className={cn(EYEBROW, "text-muted-foreground")}>
                {ACT_COPY.field_due}
              </p>
              <DueDateField
                aria-label={ACT_COPY.field_due}
                placeholder={ACT_COPY.pick_due}
                missing={flagged && !due}
                value={due}
                onChange={setDue}
                disabled={busy}
              />
            </div>
          </div>
        </>
      ) : null}

      {event ? (
        <>
          <p className="break-words text-base font-semibold text-foreground">
            {event.name}
          </p>
          <dl className="space-y-2">
            <CardRow label={ACT_COPY.field_when}>
              {actWhenLine(event.start_time, event.end_time)}
            </CardRow>
            {event.location ? (
              <CardRow label={ACT_COPY.field_where}>{event.location}</CardRow>
            ) : null}
            <CardRow label={ACT_COPY.field_attendance}>
              {event.is_mandatory ? ACT_COPY.required : ACT_COPY.optional}
            </CardRow>
            <CardRow label={ACT_COPY.field_points}>
              {event.point_value === null
                ? ACT_COPY.default_points
                : event.point_value}
            </CardRow>
          </dl>
          {event.description ? (
            <p className="break-words text-sm text-muted-foreground">
              {event.description}
            </p>
          ) : null}
        </>
      ) : null}

      <p className="text-caption text-muted-foreground">
        {points
          ? ACT_COPY.points_push
          : task
            ? ACT_COPY.task_push
            : ACT_COPY.event_push}{" "}
        {ACT_COPY.mine_only}
      </p>

      {problem ? (
        <p role="alert" className="text-sm text-destructive-text">
          {problem}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void cancel()}
        >
          {ACT_COPY.cancel}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {ACT_COPY.confirm}
        </Button>
      </div>
    </section>
  );
}

function MemberList({
  targets,
  nameOf,
  open,
  collapsible,
  onToggle,
  onRemove,
  disabled,
}: {
  targets: readonly string[];
  nameOf: (userId: string) => string;
  open: boolean;
  collapsible: boolean;
  onToggle: () => void;
  onRemove: (userId: string) => void;
  disabled: boolean;
}) {
  if (targets.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className={cn(EYEBROW, "text-muted-foreground")}>
          {ACT_COPY.field_members}
        </p>
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className={cn(
              "rounded-sm text-caption font-semibold text-muted-foreground hover:text-foreground",
              FOCUS_RING,
            )}
          >
            {open ? ACT_COPY.hide_members : ACT_COPY.show_members}
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
          {targets.map((userId) => {
            const name = nameOf(userId);
            return (
              <li
                key={userId}
                className="flex min-h-8 items-center justify-between gap-2 border-b border-border px-3 last:border-b-0"
              >
                <span className="min-w-0 truncate text-sm text-foreground">
                  {name}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(userId)}
                  aria-label={`${ACT_COPY.remove_member} ${name}`}
                  title={ACT_COPY.remove_member}
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-card-hover hover:text-foreground",
                    FOCUS_RING,
                  )}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function AddMember({
  members,
  disabled,
  onAdd,
}: {
  members: Member[];
  disabled: boolean;
  onAdd: (userId: string) => void;
}) {
  // Controlled back to empty after each pick, so it reads as an action.
  const [pick, setPick] = useState("");
  return (
    <Select
      value={pick}
      disabled={disabled}
      onValueChange={(value) => {
        onAdd(value);
        setPick("");
      }}
    >
      <SelectTrigger aria-label={ACT_COPY.add_member}>
        <SelectValue placeholder={ACT_COPY.add_member} />
      </SelectTrigger>
      <SelectContent>
        {members.map((member) => (
          <SelectItem
            key={String(member.user_id)}
            value={String(member.user_id)}
          >
            {memberLabel(member.display_name, member.user_id)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

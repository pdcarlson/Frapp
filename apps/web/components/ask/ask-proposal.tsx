"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  errorCopy,
  useAcceptAiSuggestion,
  useActEventAudience,
  useAskCards,
  useCurrentUser,
  useDismissAiSuggestion,
  useMembers,
  type ActResponse,
  type AiSuggestion,
  type AskCardEnd,
  type AskProposalResolution,
  type PointsSuggestionEdits,
  type TaskSuggestionEdits,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { codeOf } from "@repo/api-sdk";
import { dueEntryFields, dueEntryFromTask } from "@repo/formatting";
import {
  ACT_COPY,
  ASK_CARDS_COPY,
  actActionLabel,
  actMissingLine,
  actNoteLine,
  actPointsDoneLine,
  actPointsEdits,
  actRepeatLine,
  actAttendanceLine,
  actConfirmRefusalLine,
  actPointsHeadline,
  actPointsTotalLine,
  actWhenLine,
  TASK_TITLE_MAX_LENGTH,
} from "@repo/validation";
import { ReportAiButton } from "@/components/ai/report-ai";
import {
  DueDateField,
  dueEntryPassed,
} from "@/components/tasks/due-date-field";
import { EventEditorDialog } from "@/components/chat/deferred-panels";
import { isoToLocalInput } from "@/components/events/event-editor-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EYEBROW } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/**
 * A proposal in the Ask conversation on web (#718, `spec/behavior/ai.md` §
 * Asking Frapp to do something): the member typed something to do, and this
 * is the card that says exactly what would happen. Nothing changes until
 * they press Confirm.
 *
 * **A card to confirm, in the thread where it was asked.** Slack's `/remind`
 * and Linear's "create issue from text" both answer a typed request with the
 * thing filled in for the person to check, and Notion AI shows what it would
 * change before it changes it. The card here is that: the action as a title,
 * each detail on its own line, the size of a bulk change in words ("Give 5
 * points to 42 members"), and Confirm beside Cancel.
 *
 * **What can be fixed on the card is what a request leaves unsaid.** Who a
 * points change is for (take a member off, add one a name did not find), and
 * who and when for a task.
 *
 * **Every card has Edit beside Cancel** (Paul, 2026-11-15, #5117: "it got
 * the general idea down, but I'd love to be able to add attendance and change
 * the time"). Google Calendar's "Add to calendar" on an event found in mail
 * opens the full event editor, and Linear's issue-from-text opens its own
 * issue form, so an event's Edit opens the ordinary event form filled in from
 * the card (attendance by role, the end, notes, the repeat), and its Create
 * is the confirm. A points or task card is a few fields, so Edit turns its
 * words into fields on the card itself, as Linear's triage edits in place.
 *
 * **Every card in the thread stays live.** A card is not replaced by the next
 * thing asked. Once it is confirmed or dismissed it becomes one line saying
 * so, in the card's own frame, with a link to where the change can be seen.
 */

type Member = NonNullable<ReturnType<typeof useMembers>["data"]>[number];

/** Where a confirmed change can be seen, by the page the card named. */
const RESULT_LINKS: Record<string, { href: string; label: string }> = {
  points: { href: "/points", label: ACT_COPY.open_points },
  tasks: { href: "/tasks", label: ACT_COPY.open_tasks },
  events: { href: "/events", label: ACT_COPY.open_events },
};

const CARD_FRAME = "rounded-[14px] border border-border bg-card p-3";

/** What an officer changed on a waiting card, by the proposal's id. */
interface CardEdits {
  targets: string[];
  assigneeId: string;
  due: string;
  /** Edit was pressed: the card's words are fields (#5117). */
  editing: boolean;
  amount: string;
  reason: string;
  taskName: string;
  details: string;
}

/**
 * Where a waiting card's edits are kept while the conversation is closed. It
 * takes its thread off the page when it closes, and a card drawn again from
 * the proposal alone would put back the member an officer took off, and
 * Confirm would then give them the points. `ask-card.tsx` holds one of these
 * for the life of the conversation; a card outside it keeps its own.
 */
export type AskCardEditsStore = Map<string, CardEdits>;
export const AskCardEditsContext = createContext<AskCardEditsStore | null>(
  null,
);

export function AskProposal({
  proposal,
  resolution,
  onProposal,
  onResolved,
}: {
  /** What the server answered the member's words with. */
  proposal: ActResponse;
  /** Set once the card was confirmed or dismissed. */
  resolution: AskProposalResolution | null;
  /** The event pick answered with a new proposal for this turn. */
  onProposal: (proposal: ActResponse) => void;
  onResolved: (resolution: AskProposalResolution) => void;
}) {
  const audience = useActEventAudience();
  const [problem, setProblem] = useState<string | null>(null);

  if (resolution) {
    return (
      <ProposalReceipt
        headline={
          proposal.suggestion ? cardHeadline(proposal.suggestion) : null
        }
        resolution={resolution}
      />
    );
  }

  async function pickEvent(eventId: string) {
    const choice = proposal.event_choice;
    if (!choice || audience.isPending) return;
    setProblem(null);
    try {
      onProposal(
        await audience.mutateAsync({
          eventId,
          amount: choice.amount,
          reason: choice.reason,
          // The other cards in the thread stay waiting.
          keepEarlier: true,
        }),
      );
    } catch (error) {
      setProblem(errorCopy(error, ACT_COPY.failed));
    }
  }

  return (
    <div className="space-y-2">
      <ActAnswer
        response={proposal}
        busy={audience.isPending}
        onPickEvent={(eventId) => void pickEvent(eventId)}
        onDone={(line, page) => onResolved({ kind: "done", line, page })}
        onCancelled={() => onResolved({ kind: "cancelled" })}
        onGone={() => onResolved({ kind: "gone" })}
      />
      {problem ? (
        <p role="alert" className="text-sm text-destructive-text">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** What the card was about, in a few words, once it is one line. */
function cardHeadline(suggestion: AiSuggestion): string | null {
  if (suggestion.task) return suggestion.task.title;
  if (suggestion.new_event) return suggestion.new_event.name;
  return suggestion.points?.reason ?? null;
}

/** What a card that ended says in its place. */
function resolutionLine(resolution: AskProposalResolution): string {
  if (resolution.kind === "done") return resolution.line;
  return resolution.kind === "gone" ? ACT_COPY.gone : ACT_COPY.cancelled;
}

/** A card that ended: what happened, in the frame the card had. */
function ProposalReceipt({
  headline,
  resolution,
}: {
  headline: string | null;
  resolution: AskProposalResolution;
}) {
  const link =
    resolution.kind === "done" ? RESULT_LINKS[resolution.page ?? ""] : null;
  return (
    <section className={cn(CARD_FRAME, "space-y-1")}>
      {headline ? (
        <p className="break-words text-sm font-semibold text-foreground">
          {headline}
        </p>
      ) : null}
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-sm text-muted-foreground">
          {resolutionLine(resolution)}
        </p>
        {link ? (
          <Button asChild variant="ghost" size="sm" className="-mr-2">
            <Link href={link.href}>{link.label}</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The cards an answer came with (`answer.proposals`, #4904): each waits for
 * its own Confirm, under the words that led to it, the way Claude and ChatGPT
 * stack one approval per action under a reply. A card that ended is one line
 * in its frame, as a turn's single card is. One the server no longer holds
 * (decided on another device, or a day passed) says so in the same frame.
 *
 * While the cards are being read, each holds a frame of a card's usual
 * height, so the thread does not jump when they arrive.
 */
export function AskAnswerCards({
  ids,
  ended,
  onEnded,
}: {
  ids: readonly string[];
  /** How each card that is no longer waiting ended, by its id. */
  ended: Readonly<Record<string, AskCardEnd>>;
  onEnded: (suggestionId: string, end: AskCardEnd) => void;
}) {
  const waiting = useMemo(() => ids.filter((id) => !ended[id]), [ids, ended]);
  const cards = useAskCards(waiting);
  return (
    <div className="space-y-2" data-testid="ask-answer-cards">
      {ids.map((id) => {
        const end = ended[id];
        if (end) {
          return (
            <ProposalReceipt
              key={id}
              headline={end.headline}
              resolution={end.resolution}
            />
          );
        }
        const suggestion = cards.byId.get(id);
        if (suggestion) {
          const headline = cardHeadline(suggestion);
          return (
            <ActCard
              key={id}
              suggestion={suggestion}
              notes={NO_NOTES}
              onDone={(line, page) =>
                onEnded(id, {
                  resolution: { kind: "done", line, page },
                  headline,
                })
              }
              onCancelled={() =>
                onEnded(id, { resolution: { kind: "cancelled" }, headline })
              }
              onGone={() =>
                onEnded(id, { resolution: { kind: "gone" }, headline })
              }
            />
          );
        }
        if (!cards.settled) {
          // The list could not be read: the card may well still be waiting,
          // so it is not called gone. It comes back when the list is read.
          return cards.failed ? (
            <section key={id} className={CARD_FRAME}>
              <p role="alert" className="text-sm text-muted-foreground">
                {ASK_CARDS_COPY.unread}
              </p>
            </section>
          ) : (
            <section
              key={id}
              aria-busy="true"
              className={cn(CARD_FRAME, "h-28 opacity-60")}
            />
          );
        }
        return (
          <ProposalReceipt
            key={id}
            headline={null}
            resolution={{ kind: "gone" }}
          />
        );
      })}
    </div>
  );
}

/** A card under an answer carries no notes: they come only with a typed request. */
const NO_NOTES: ActResponse["notes"] = [];

function ActAnswer({
  response,
  busy,
  onPickEvent,
  onDone,
  onCancelled,
  onGone,
}: {
  response: ActResponse;
  /** An event pick is on its way: the choices wait. */
  busy: boolean;
  onPickEvent: (eventId: string) => void;
  onDone: (line: string, page: string) => void;
  onCancelled: () => void;
  /** The proposal stopped waiting before the member decided. */
  onGone: () => void;
}) {
  if (response.status === "proposed" && response.suggestion) {
    return (
      <ActCard
        suggestion={response.suggestion}
        notes={response.notes}
        onDone={onDone}
        onCancelled={onCancelled}
        onGone={onGone}
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
                disabled={busy}
                onClick={() => onPickEvent(event.id)}
                className={cn(
                  "w-full rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-card-hover disabled:opacity-60",
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
  // `unclear`. A card is never `unavailable` or `refused`: those end a turn
  // as an answer, and an event pick that may not run is an error, not a card.
  return (
    <p className="text-sm text-foreground">
      {actMissingLine(response.missing)}
    </p>
  );
}

/** The proposal is no longer waiting: a day passed, or it was decided elsewhere. */
function isGone(error: unknown): boolean {
  return [
    "ai.suggestion.decided",
    "ai.suggestion.expired",
    "ai.suggestion.not_found",
  ].includes(codeOf(error) ?? "");
}

/** Why a Confirm or Cancel was refused, in words an officer can act on. */
function refusalLine(error: unknown): string {
  return (
    actConfirmRefusalLine(codeOf(error) ?? null) ??
    errorCopy(error, ACT_COPY.failed)
  );
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
  onGone,
}: {
  suggestion: AiSuggestion;
  notes: ActResponse["notes"];
  onDone: (line: string, page: string) => void;
  onCancelled: () => void;
  /** The proposal stopped waiting before the member decided. */
  onGone: () => void;
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

  const { points, task, new_event: event } = suggestion;
  const store = useContext(AskCardEditsContext);
  const kept = store?.get(suggestion.id);
  const [targets, setTargets] = useState<string[]>(
    kept?.targets ?? points?.target_user_ids ?? [],
  );
  const [assigneeId, setAssigneeId] = useState(
    kept?.assigneeId ?? task?.assignee_id ?? "",
  );
  // The suggestion's own due: kept even once its time has passed (#4512).
  const suggestedDue = task?.due_date
    ? dueEntryFromTask({ due_date: task.due_date, due_at: task.due_at })
    : "";
  const [due, setDue] = useState(kept?.due ?? suggestedDue);
  const [editing, setEditing] = useState(kept?.editing ?? false);
  const [amount, setAmount] = useState(
    kept?.amount ?? (points ? String(points.amount) : ""),
  );
  const [reason, setReason] = useState(kept?.reason ?? points?.reason ?? "");
  const [taskName, setTaskName] = useState(kept?.taskName ?? task?.title ?? "");
  const [details, setDetails] = useState(
    kept?.details ?? task?.description ?? "",
  );
  useEffect(() => {
    store?.set(suggestion.id, {
      targets,
      assigneeId,
      due,
      editing,
      amount,
      reason,
      taskName,
      details,
    });
  }, [
    store,
    suggestion.id,
    targets,
    assigneeId,
    due,
    editing,
    amount,
    reason,
    taskName,
    details,
  ]);
  const [fieldProblem, setFieldProblem] = useState<{
    field: "amount" | "reason" | "taskName";
    error: string;
  } | null>(null);
  // The event form: mounted on the first Edit and kept, so it can animate
  // closed; what was typed is kept under the card's name (#4593).
  const [eventForm, setEventForm] = useState<boolean | null>(null);
  // One object for the proposal: the form fills again when it changes.
  const eventTemplate = useMemo(
    () =>
      event
        ? {
            name: event.name,
            description: event.description,
            location: event.location,
            point_value: event.point_value,
            is_mandatory: event.is_mandatory,
          }
        : null,
    [event],
  );
  const shownAmount = useMemo(() => {
    if (!points || !editing) return points?.amount ?? 0;
    const read = actPointsEdits(points, amount, "-");
    return read.ok ? (read.edits.amount ?? points.amount) : points.amount;
  }, [points, editing, amount]);
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
      const changes: PointsSuggestionEdits = {};
      if (editing) {
        const read = actPointsEdits(points, amount, reason);
        if (!read.ok) {
          return setFieldProblem({ field: read.field, error: read.error });
        }
        Object.assign(changes, read.edits);
      }
      const changed =
        targets.length !== points.target_user_ids.length ||
        targets.some((id) => !points.target_user_ids.includes(id));
      if (changed) changes.target_user_ids = targets;
      if (Object.keys(changes).length > 0) edits = { points: changes };
    }
    if (task) {
      const changes: TaskSuggestionEdits = {};
      if (editing) {
        const name = taskName.trim().slice(0, TASK_TITLE_MAX_LENGTH);
        if (!name) {
          return setFieldProblem({
            field: "taskName",
            error: ACT_COPY.no_task_name,
          });
        }
        if (name !== task.title) changes.title = name;
        const said = details.trim() || null;
        if (said !== (task.description ?? null)) changes.description = said;
      }
      if (!assigneeId || !due) return setFlagged(true);
      if (dueEntryPassed(due, new Date(), suggestedDue)) {
        return setFlagged(true);
      }
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
            edits.points?.amount ?? points.amount,
            outcome?.adjusted ?? targets.length,
            outcome?.skipped ?? 0,
          ),
          "points",
        );
      } else if (task) {
        onDone(ACT_COPY.done_task, "tasks");
      } else {
        onDone(ACT_COPY.done_event, "events");
      }
    } catch (error) {
      // A card that stopped waiting says so in its place, with no buttons.
      if (isGone(error)) onGone();
      else setProblem(refusalLine(error));
    }
  }

  async function cancel() {
    setProblem(null);
    try {
      await dismiss.mutateAsync(suggestion.id);
    } catch (error) {
      // Already decided elsewhere: it may have been confirmed, so the card
      // does not say cancelled.
      if (codeOf(error) === "ai.suggestion.decided") {
        onGone();
        return;
      }
      // Already gone is what Cancel wanted.
      if (!isGone(error)) {
        setProblem(refusalLine(error));
        return;
      }
    }
    onCancelled();
  }

  /** Edit: the event form, or the card's words as fields. */
  function edit() {
    setProblem(null);
    if (event) setEventForm(true);
    else setEditing(true);
  }

  // Create in the event form is the confirm: the form made the event through
  // its own route, and the accept records it on this proposal. The event is
  // made whatever the accept does, so the card says so either way; a
  // proposal left waiting expires the next day.
  async function recordMadeEvent(eventId: string) {
    await accept
      .mutateAsync({ id: suggestion.id, newEventId: eventId })
      .catch(() => undefined);
    onDone(ACT_COPY.done_event, "events");
  }

  const addable = members.filter(
    (member) =>
      member.user_id !== me && !targets.includes(String(member.user_id)),
  );

  let title: string = ACT_COPY.card_event_title;
  if (points) {
    title =
      shownAmount < 0
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
    <section aria-label={title} className={cn(CARD_FRAME, "space-y-3")}>
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
              {actPointsHeadline(shownAmount, targets.length)}
            </p>
            {/* One line high with or without it, so removing down to one member moves nothing. */}
            <p className="min-h-[18px] text-caption text-muted-foreground">
              {actPointsTotalLine(shownAmount, targets.length)}
            </p>
          </div>
          {editing ? (
            <div className="space-y-2">
              <CardField
                id={`${suggestion.id}-amount`}
                label={ACT_COPY.field_amount}
                hint={ACT_COPY.amount_hint}
                problem={
                  fieldProblem?.field === "amount" ? fieldProblem.error : null
                }
              >
                <Input
                  id={`${suggestion.id}-amount`}
                  inputMode="numeric"
                  value={amount}
                  disabled={busy}
                  aria-invalid={fieldProblem?.field === "amount" || undefined}
                  onChange={(change) => {
                    setAmount(change.target.value);
                    if (fieldProblem?.field === "amount") setFieldProblem(null);
                  }}
                />
              </CardField>
              <CardField
                id={`${suggestion.id}-reason`}
                label={ACT_COPY.field_reason}
                problem={
                  fieldProblem?.field === "reason" ? fieldProblem.error : null
                }
              >
                <Input
                  id={`${suggestion.id}-reason`}
                  value={reason}
                  disabled={busy}
                  aria-invalid={fieldProblem?.field === "reason" || undefined}
                  onChange={(change) => {
                    setReason(change.target.value);
                    if (fieldProblem?.field === "reason") setFieldProblem(null);
                  }}
                />
              </CardField>
            </div>
          ) : null}
          <dl className="space-y-2">
            {editing ? null : (
              <CardRow label={ACT_COPY.field_reason}>{points.reason}</CardRow>
            )}
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
          {editing ? (
            <div className="space-y-2">
              <CardField
                id={`${suggestion.id}-task`}
                label={ACT_COPY.field_task_name}
                problem={
                  fieldProblem?.field === "taskName" ? fieldProblem.error : null
                }
              >
                <Input
                  id={`${suggestion.id}-task`}
                  value={taskName}
                  maxLength={TASK_TITLE_MAX_LENGTH}
                  disabled={busy}
                  aria-invalid={fieldProblem?.field === "taskName" || undefined}
                  onChange={(change) => {
                    setTaskName(change.target.value);
                    if (fieldProblem?.field === "taskName") {
                      setFieldProblem(null);
                    }
                  }}
                />
              </CardField>
              <CardField
                id={`${suggestion.id}-details`}
                label={ACT_COPY.field_details}
                problem={null}
              >
                <Textarea
                  id={`${suggestion.id}-details`}
                  value={details}
                  rows={3}
                  disabled={busy}
                  onChange={(change) => setDetails(change.target.value)}
                />
              </CardField>
            </div>
          ) : (
            <>
              <p className="break-words text-base font-semibold text-foreground">
                {task.title}
              </p>
              {task.description ? (
                <p className="break-words text-sm text-muted-foreground">
                  {task.description}
                </p>
              ) : null}
            </>
          )}
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
                passed={
                  flagged && dueEntryPassed(due, new Date(), suggestedDue)
                }
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
            {event.recurrence_rule ? (
              <CardRow label={ACT_COPY.field_repeats}>
                {actRepeatLine(event.recurrence_rule, event.start_time)}
              </CardRow>
            ) : null}
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
        {editing ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={edit}
          >
            {ACT_COPY.edit}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {ACT_COPY.confirm}
        </Button>
      </div>
      {event && eventForm !== null ? (
        <EventEditorDialog
          open={eventForm}
          onOpenChange={setEventForm}
          mode="create"
          event={null}
          usingPreviewData={false}
          template={eventTemplate}
          initialStartAt={isoToLocalInput(event.start_time)}
          initialEndAt={isoToLocalInput(event.end_time)}
          initialRepeatRule={event.recurrence_rule}
          keptDraft={`ask-event:${suggestion.id}`}
          onCreated={recordMadeEvent}
          onSaved={() => undefined}
        />
      ) : null}
    </section>
  );
}

/** A field on the card under its Edit, with its label above. */
function CardField({
  id,
  label,
  hint,
  problem,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  problem: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={cn(EYEBROW, "text-muted-foreground")}>
        {label}
      </label>
      {children}
      {problem ? (
        <p role="alert" className="text-caption text-destructive-text">
          {problem}
        </p>
      ) : hint ? (
        <p className="text-caption text-muted-foreground">{hint}</p>
      ) : null}
    </div>
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

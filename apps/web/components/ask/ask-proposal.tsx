"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  errorCopy,
  useAcceptAiSuggestion,
  useActEventAudience,
  useCurrentUser,
  useDismissAiSuggestion,
  useMembers,
  type ActResponse,
  type AiSuggestion,
  type AskProposalResolution,
  type PointsSuggestionEdits,
  type TaskSuggestionEdits,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { codeOf } from "@repo/api-sdk";
import { dueEntryFields, dueEntryFromTask } from "@repo/formatting";
import {
  ACT_COPY,
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
import {
  DueDateField,
  dueEntryPassed,
} from "@/components/tasks/due-date-field";
import { Button } from "@/components/ui/button";
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
 * who and when for a task. Everything else is said again in other words, in
 * the same field: the conversation carries what was typed before.
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

export function AskProposal({
  proposal,
  resolution,
  onProposal,
  onResolved,
  onAnswerConsent,
  onLeave,
}: {
  /** What the server answered the member's words with. */
  proposal: ActResponse;
  /** Set once the card was confirmed or dismissed. */
  resolution: AskProposalResolution | null;
  /** The event pick answered with a new proposal for this turn. */
  onProposal: (proposal: ActResponse) => void;
  onResolved: (resolution: AskProposalResolution) => void;
  /** Opens the AI sheet, for a pick refused because it is unanswered. */
  onAnswerConsent: () => void;
  /** A link out of the panel was followed. */
  onLeave?: () => void;
}) {
  const audience = useActEventAudience();
  const [problem, setProblem] = useState<string | null>(null);

  if (resolution) {
    return (
      <ProposalReceipt
        proposal={proposal}
        resolution={resolution}
        onLeave={onLeave}
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
        onAnswerConsent={onAnswerConsent}
        onPickEvent={(eventId) => void pickEvent(eventId)}
        onDone={(line, page) => onResolved({ kind: "done", line, page })}
        onCancelled={() => onResolved({ kind: "cancelled" })}
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
function proposalHeadline(proposal: ActResponse): string | null {
  const suggestion = proposal.suggestion;
  if (!suggestion) return null;
  if (suggestion.task) return suggestion.task.title;
  if (suggestion.new_event) return suggestion.new_event.name;
  return suggestion.points?.reason ?? null;
}

/** A card that ended: what happened, in the frame the card had. */
function ProposalReceipt({
  proposal,
  resolution,
  onLeave,
}: {
  proposal: ActResponse;
  resolution: AskProposalResolution;
  onLeave?: () => void;
}) {
  const headline = proposalHeadline(proposal);
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
          {resolution.kind === "done" ? resolution.line : ACT_COPY.cancelled}
        </p>
        {link ? (
          <Button asChild variant="ghost" size="sm" className="-mr-2">
            <Link href={link.href} onClick={onLeave}>
              {link.label}
            </Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ActAnswer({
  response,
  busy,
  onAnswerConsent,
  onPickEvent,
  onDone,
  onCancelled,
}: {
  response: ActResponse;
  /** An event pick is on its way: the choices wait. */
  busy: boolean;
  onAnswerConsent: () => void;
  onPickEvent: (eventId: string) => void;
  onDone: (line: string, page: string) => void;
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
  onDone: (line: string, page: string) => void;
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

  const { points, task, new_event: event } = suggestion;
  const [targets, setTargets] = useState<string[]>(
    points?.target_user_ids ?? [],
  );
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? "");
  // The suggestion's own due: kept even once its time has passed (#4512).
  const suggestedDue = task?.due_date
    ? dueEntryFromTask({ due_date: task.due_date, due_at: task.due_at })
    : "";
  const [due, setDue] = useState(suggestedDue);
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
      if (dueEntryPassed(due, new Date(), suggestedDue)) {
        return setFlagged(true);
      }
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
          "points",
        );
      } else if (task) {
        onDone(ACT_COPY.done_task, "tasks");
      } else {
        onDone(ACT_COPY.done_event, "events");
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

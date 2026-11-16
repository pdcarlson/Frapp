"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  AlignLeft,
  CalendarDays,
  CircleCheck,
  CircleX,
  Clock,
  ListChecks,
  MoreHorizontal,
  Repeat,
  Star,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  errorCopy,
  useAcceptAiSuggestion,
  useActEventAudience,
  useAskCards,
  useCurrentUser,
  useDismissAiSuggestion,
  useMembers,
  useMyPermissions,
  settleProposedEvent,
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
  AI_REPORT_COPY,
  ASK_CARDS_COPY,
  actActionLabel,
  actEventPointsInput,
  actEventPointsLine,
  actPointsAction,
  actPointsFromLine,
  actRepeatParts,
  actWhenParts,
  actMissingLine,
  actNoteLine,
  actPointsDoneLine,
  actPointsEdits,
  actAttendanceLine,
  actConfirmRefusalLine,
  can,
  actPointsHeadline,
  actPointsTotalLine,
  actWhenLine,
  meetingDueLabel,
  TASK_TITLE_MAX_LENGTH,
} from "@repo/validation";
import { ReportAiDialog } from "@/components/ai/report-ai";
import {
  DueDateField,
  dueEntryPassed,
} from "@/components/tasks/due-date-field";
import { deferredPanel } from "@/components/chat/deferred-panel";
import { isoToLocalInput } from "@/components/events/local-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
/**
 * The full event form an event card's Edit opens, loaded on first open: Ask
 * is drawn on every dashboard route, and the form is a large download. Not the
 * chat shell's own deferred copy, which would import the shell's panels and
 * make a cycle back to Ask.
 */
const EventEditorDialog = deferredPanel(
  () =>
    import("@/components/events/event-editor-dialog").then(
      (m) => m.EventEditorDialog,
    ),
  "dialog",
);

const RESULT_LINKS: Record<string, { href: string; label: string }> = {
  points: { href: "/points", label: ACT_COPY.open_points },
  tasks: { href: "/tasks", label: ACT_COPY.open_tasks },
  events: { href: "/events", label: ACT_COPY.open_events },
};

/** The accept route's limit on a task suggestion's details. */
const TASK_SUGGESTION_DETAILS_MAX_LENGTH = 2000;

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
  /** Points typed into an event card's empty field (#5148). */
  eventPoints: string;
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
      <FinishedCard
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
        onDone={(line, page, made) =>
          onResolved({ kind: "done", line, page, ...made })
        }
        onCancelled={(shown) => onResolved({ kind: "cancelled", shown })}
        onGone={(shown) => onResolved({ kind: "gone", shown })}
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

/** What a card that ended says in its top line. */
function resolutionLine(resolution: AskProposalResolution): string {
  if (resolution.kind === "done") return resolution.line;
  return resolution.kind === "gone" ? ACT_COPY.gone : ACT_COPY.cancelled;
}

/** Where a finished change can be opened: the event itself, else its page. */
function resultLink(
  resolution: AskProposalResolution,
): { href: string; label: string } | null {
  if (resolution.kind !== "done") return null;
  if (resolution.page === "events" && resolution.id) {
    return {
      href: `/events?event=${encodeURIComponent(resolution.id)}`,
      label: ACT_COPY.open_event,
    };
  }
  return RESULT_LINKS[resolution.page ?? ""] ?? null;
}

/**
 * A card that ended (Paul, 2026-11-16, #5148: "we should still see it and
 * just grey it out"). Slack's approval messages stay where they were once
 * handled, greyed, with what happened on top, so the conversation still
 * reads. Here the card keeps its details as they stood, faded and with no
 * controls, under one line that says how it ended. Without the card as it
 * stood (an event made in the full form, a card from before), its name.
 */
function FinishedCard({
  headline,
  resolution,
}: {
  headline: string | null;
  resolution: AskProposalResolution;
}) {
  const link = resultLink(resolution);
  const shown = resolution.shown ?? null;
  const Icon: LucideIcon =
    resolution.kind === "done"
      ? CircleCheck
      : resolution.kind === "gone"
        ? Clock
        : CircleX;
  const title = shown ? cardHeadline(shown) : headline;
  return (
    <section
      className={cn(CARD_FRAME, "space-y-2.5 bg-surface-1")}
      data-testid="ask-card-finished"
    >
      <div className="flex min-h-8 items-center gap-2">
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            resolution.kind === "done" ? "text-success" : "text-muted",
          )}
          aria-hidden="true"
        />
        <p
          className={cn(
            "min-w-0 flex-1 text-sm font-semibold",
            resolution.kind === "done" ? "text-success" : "text-muted",
          )}
        >
          {resolutionLine(resolution)}
        </p>
        {link ? (
          <Button asChild variant="ghost" size="sm" className="-mr-2">
            <Link href={link.href}>{link.label}</Link>
          </Button>
        ) : null}
      </div>
      <div className="space-y-2.5 opacity-55">
        {title ? (
          <p
            className={cn(
              "break-words text-base font-semibold text-foreground",
              resolution.kind === "cancelled" && "line-through",
            )}
          >
            {title}
          </p>
        ) : null}
        {shown ? <CardDetails suggestion={shown} /> : null}
      </div>
    </section>
  );
}

/**
 * What a finished card still shows under its name: the same rows the
 * waiting card had, as words.
 */
function CardDetails({ suggestion }: { suggestion: AiSuggestion }) {
  const { points, task, new_event: event } = suggestion;
  if (event) return <EventFacts event={event} />;
  if (task) {
    return (
      <div className="space-y-1.5">
        {task.description ? (
          <p className="break-words text-sm text-muted-foreground">
            {task.description}
          </p>
        ) : null}
        {task.due_date ? (
          <Fact icon={Clock}>
            {meetingDueLabel(task.due_date)}
          </Fact>
        ) : null}
      </div>
    );
  }
  if (points) {
    return (
      <div className="space-y-1.5">
        <Fact icon={AlignLeft}>{points.reason}</Fact>
        {points.event_name ? (
          <Fact icon={Users}>
            {actAttendanceLine(points.event_name, points.event_start_time)}
          </Fact>
        ) : null}
      </div>
    );
  }
  return null;
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
            <FinishedCard
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
              onDone={(line, page, made) =>
                onEnded(id, {
                  resolution: { kind: "done", line, page, ...made },
                  headline,
                })
              }
              onCancelled={(shown) =>
                onEnded(id, {
                  resolution: { kind: "cancelled", shown },
                  headline,
                })
              }
              onGone={(shown) =>
                onEnded(id, { resolution: { kind: "gone", shown }, headline })
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
          <FinishedCard
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
  onDone: CardDone;
  onCancelled: (shown: AiSuggestion) => void;
  /** The proposal stopped waiting before the member decided. */
  onGone: (shown: AiSuggestion) => void;
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

/** What a card reports once it was carried out. */
type CardDone = (
  line: string,
  page: string,
  made: { id?: string | null; shown?: AiSuggestion | null },
) => void;

/** One detail on a card: its icon, then the words (Google Calendar's rows). */
function Fact({
  icon: Icon,
  children,
  under,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  /** A quieter line under it: where copied points came from, a count. */
  under?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-foreground">
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 break-words">
        {children}
        {under ? (
          <span className="block text-caption text-muted-foreground">
            {under}
          </span>
        ) : null}
      </div>
    </div>
  );
}

type ProposedEvent = NonNullable<AiSuggestion["new_event"]>;

/**
 * When a proposed event is, the way a calendar invite opens: a small tile
 * with the weekday and the day, then the whole date over the times.
 */
function EventWhen({ event }: { event: ProposedEvent }) {
  const when = actWhenParts(event.start_time, event.end_time);
  if (!when) return null;
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden="true"
        className="w-11 shrink-0 rounded-[10px] border border-border bg-surface-1 py-1 text-center"
      >
        <span className="block text-[10.5px] font-bold tracking-[0.06em] text-primary">
          {when.weekday}
        </span>
        <span className="block text-lg font-semibold leading-tight text-foreground">
          {when.day}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{when.date}</p>
        <p className="text-sm text-muted-foreground">
          {when.times}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      </div>
    </div>
  );
}

/** A proposed event's details, as words: shared by the live and finished card. */
function EventFacts({
  event,
  pointsField,
}: {
  event: ProposedEvent;
  /** The empty points field, in place of the points line, while it waits. */
  pointsField?: React.ReactNode;
}) {
  const repeat = actRepeatParts(event.recurrence_rule, event.start_time);
  return (
    <div className="space-y-2.5">
      <EventWhen event={event} />
      <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
        {repeat ? (
          <Fact icon={Repeat} under={repeat.count || undefined}>
            {repeat.line}
          </Fact>
        ) : null}
        <Fact icon={Users}>
          {event.is_mandatory
            ? ACT_COPY.everyone_required
            : ACT_COPY.everyone_optional}
        </Fact>
        {pointsField ??
          (event.point_value === null ? null : (
            <Fact
              icon={Star}
              under={actPointsFromLine(event.points_from) || undefined}
            >
              {actEventPointsLine(event.point_value, !!event.recurrence_rule)}
            </Fact>
          ))}
      </div>
      {event.description ? (
        <p className="break-words text-sm text-muted-foreground">
          {event.description}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The ··· in a card's corner (Paul, 2026-11-16, #5148: Cancel goes into the
 * menu): Dismiss, and Report this for the Frapp team (#4315). Report is left
 * out for a member who could never send one, as `ReportAiButton` does.
 */
function CardMenu({
  title,
  suggestionId,
  disabled,
  onDismiss,
}: {
  title: string;
  suggestionId: string;
  disabled: boolean;
  onDismiss: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const permissions = useMyPermissions().data?.permissions;
  const canReport = !!permissions && can("ai:use", permissions);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-1.5 h-8 w-8"
            aria-label={`${ACT_COPY.more}: ${title}`}
            disabled={disabled}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDismiss}>
            {ACT_COPY.dismiss}
          </DropdownMenuItem>
          {canReport ? (
            <DropdownMenuItem
              disabled={reported}
              onSelect={() => setReporting(true)}
            >
              {reported ? AI_REPORT_COPY.reported : AI_REPORT_COPY.action}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {reporting ? (
        <ReportAiDialog
          target={{ subject: "ai_suggestion", subjectId: suggestionId }}
          onClose={() => setReporting(false)}
          onReported={() => setReported(true)}
        />
      ) : null}
    </>
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
  onDone: CardDone;
  /** Dismissed: the card as it stood, to stay in place greyed. */
  onCancelled: (shown: AiSuggestion) => void;
  /** The proposal stopped waiting before the member decided. */
  onGone: (shown: AiSuggestion) => void;
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
  // An event's points when nobody said them and nothing matched (#5148).
  const [eventPoints, setEventPoints] = useState(kept?.eventPoints ?? "");
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
      eventPoints,
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
    eventPoints,
  ]);
  const [fieldProblem, setFieldProblem] = useState<{
    field: "amount" | "reason" | "taskName" | "eventPoints";
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
  const needsPoints = !!event && event.point_value === null;

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
    let edits: {
      points?: PointsSuggestionEdits;
      task?: TaskSuggestionEdits;
      newEventPoints?: number;
    } = {};
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
        const said =
          details.trim().slice(0, TASK_SUGGESTION_DETAILS_MAX_LENGTH) || null;
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
    if (needsPoints) {
      const read = actEventPointsInput(eventPoints);
      if (!read.ok) {
        return setFieldProblem({ field: "eventPoints", error: read.error });
      }
      edits = { newEventPoints: read.value };
    }
    try {
      const decision = await accept.mutateAsync({
        id: suggestion.id,
        ...edits,
      });
      const shown = shownAfter(suggestion, {
        targets,
        amount: edits.points?.amount,
        reason: edits.points?.reason,
        task: edits.task,
        eventPoints: edits.newEventPoints,
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
          { shown },
        );
      } else if (task) {
        onDone(ACT_COPY.done_task, "tasks", { shown });
      } else {
        onDone(ACT_COPY.done_event, "events", {
          id: decision.result?.id ?? null,
          shown,
        });
      }
    } catch (error) {
      // A card that stopped waiting says so in its place, with no buttons.
      if (isGone(error)) onGone(suggestion);
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
        onGone(suggestion);
        return;
      }
      // Already gone is what Cancel wanted.
      if (!isGone(error)) {
        setProblem(refusalLine(error));
        return;
      }
    }
    onCancelled(suggestion);
  }

  /** Edit: the event form, or the card's words as fields. */
  function edit() {
    setProblem(null);
    if (event) setEventForm(true);
    else setEditing(true);
  }

  // Create in the event form is the confirm: the form made the event through
  // its own route, and the proposal records it (or is taken down). The event
  // is made either way, so the card says so either way. Not awaited by the
  // form, which closes at once rather than offering Create again while this
  // runs. What the form made is the form's, so the card keeps only its name.
  function recordMadeEvent(eventId: string) {
    void settleProposedEvent({ accept, dismiss }, suggestion.id, eventId).then(
      () => onDone(ACT_COPY.done_event, "events", { id: eventId }),
    );
  }

  const addable = members.filter(
    (member) =>
      member.user_id !== me && !targets.includes(String(member.user_id)),
  );

  let title: string = ACT_COPY.card_event_title;
  let icon: LucideIcon = CalendarDays;
  let action: string = ACT_COPY.create_event;
  if (points) {
    title =
      shownAmount < 0
        ? ACT_COPY.card_points_title_take
        : ACT_COPY.card_points_title_give;
    icon = Star;
    action = actPointsAction(shownAmount);
  } else if (task) {
    title = ACT_COPY.card_task_title;
    icon = ListChecks;
    action = ACT_COPY.create_task;
  }
  const HeadIcon = icon;

  // Above the controls it points at ("Add them below").
  const notesStrip =
    noteLines.length > 0 ? (
      <ul className="space-y-1 rounded-md bg-surface-1 px-3 py-2 text-caption text-foreground">
        {noteLines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    ) : null;

  const pointsMissing = fieldProblem?.field === "eventPoints";
  const eventPointsField = needsPoints ? (
    <div
      className={cn(
        "rounded-[10px] border-[1.5px] border-warning/70 bg-warning-tint px-2.5 py-2 sm:col-span-2",
        pointsMissing && "border-destructive",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Star
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <label
          htmlFor={`${suggestion.id}-event-points`}
          className="text-sm text-foreground"
        >
          {ACT_COPY.points_label}
        </label>
        <Input
          id={`${suggestion.id}-event-points`}
          inputMode="numeric"
          value={eventPoints}
          disabled={busy}
          className="ml-auto h-8 w-20 text-right"
          aria-invalid={pointsMissing || undefined}
          aria-describedby={`${suggestion.id}-event-points-hint`}
          onChange={(change) => {
            setEventPoints(change.target.value);
            if (pointsMissing) setFieldProblem(null);
          }}
        />
      </div>
      <p
        id={`${suggestion.id}-event-points-hint`}
        role={pointsMissing ? "alert" : undefined}
        className={cn(
          "mt-1 pl-[26px] text-caption",
          pointsMissing ? "text-destructive-text" : "text-warning",
        )}
      >
        {pointsMissing ? fieldProblem.error : ACT_COPY.points_missing}
      </p>
    </div>
  ) : null;

  return (
    <section aria-label={title} className={cn(CARD_FRAME, "space-y-3")}>
      <div className="flex min-h-8 items-center gap-2 text-muted-foreground">
        <HeadIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-semibold">{title}</p>
        <CardMenu
          title={title}
          suggestionId={suggestion.id}
          disabled={busy}
          onDismiss={() => void cancel()}
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
          <div className="space-y-2">
            {editing ? null : <Fact icon={AlignLeft}>{points.reason}</Fact>}
            {points.event_name ? (
              <Fact icon={Users}>
                {actAttendanceLine(points.event_name, points.event_start_time)}
              </Fact>
            ) : null}
          </div>
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
                  maxLength={TASK_SUGGESTION_DETAILS_MAX_LENGTH}
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
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-start gap-2.5">
              <User
                className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <Select
                  value={assigneeId}
                  onValueChange={setAssigneeId}
                  disabled={busy}
                >
                  <SelectTrigger
                    aria-label={ACT_COPY.field_for}
                    aria-invalid={(flagged && !assigneeId) || undefined}
                    className={cn(
                      !assigneeId &&
                        "border-[1.5px] border-warning/70 bg-warning-tint",
                    )}
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
                  <p role="alert" className="text-caption text-destructive-text">
                    {ACT_COPY.need_assignee}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Clock
                className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
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
          </div>
        </>
      ) : null}

      {event ? (
        <>
          <p className="break-words text-base font-semibold text-foreground">
            {event.name}
          </p>
          <EventFacts event={event} pointsField={eventPointsField} />
        </>
      ) : null}

      <p className="text-caption text-muted-foreground">
        {ACT_COPY.mine_only}{" "}
        {points
          ? ACT_COPY.points_push
          : task
            ? ACT_COPY.task_push
            : ACT_COPY.event_push}
      </p>

      {problem ? (
        <p role="alert" className="text-sm text-destructive-text">
          {problem}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {editing ? null : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={edit}
          >
            {ACT_COPY.edit}
          </Button>
        )}
        {/* Its words stay while it saves; only the button dims (P4). */}
        <Button
          type="button"
          size="sm"
          disabled={busy}
          aria-busy={accept.isPending || undefined}
          onClick={() => void confirm()}
        >
          {action}
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

/**
 * The card as it was carried out, with what the member changed on it, for
 * the greyed card that stays in its place (#5148).
 */
function shownAfter(
  suggestion: AiSuggestion,
  changes: {
    targets: string[];
    amount?: number;
    reason?: string;
    task?: TaskSuggestionEdits;
    eventPoints?: number;
  },
): AiSuggestion {
  const { points, task, new_event: event } = suggestion;
  return {
    ...suggestion,
    points: points
      ? {
          ...points,
          target_user_ids: changes.targets,
          amount: changes.amount ?? points.amount,
          reason: changes.reason ?? points.reason,
        }
      : points,
    task: task ? { ...task, ...changes.task } : task,
    new_event:
      event && changes.eventPoints !== undefined
        ? { ...event, point_value: changes.eventPoints, points_from: null }
        : event,
  };
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

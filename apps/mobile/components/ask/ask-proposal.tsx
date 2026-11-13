import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { codeOf } from "@repo/api-sdk";
import {
  memberFallbackLabel,
  useAcceptAiSuggestion,
  useActEventAudience,
  useChapterRoster,
  useCurrentUser,
  useDismissAiSuggestion,
  type ActResponse,
  type AiSuggestion,
  type AskProposalResolution,
  type PointsSuggestionEdits,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  ACT_COPY,
  AI_REPORT_COPY,
  actActionLabel,
  actAttendanceLine,
  actConfirmRefusalLine,
  actMissingLine,
  actNoteLine,
  actPointsDoneLine,
  actPointsHeadline,
  actPointsTotalLine,
  actWhenLine,
  meetingDueLabel,
} from "@repo/validation";
import type { useAiReport } from "@/components/ai/report-ai-sheet";
import { CloseGlyph } from "@/components/control-glyphs";
import { eyebrowStyle } from "@/components/eyebrow";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import {
  NewTaskSheet,
  type TaskSuggestionSeed,
} from "@/components/tasks/new-task-sheet";
import { suggestionEdits } from "@/lib/tasks/suggestion-edits";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * A proposal in the Ask conversation on the phone (#718,
 * `spec/behavior/ai.md` § Asking Frapp to do something): an officer leaving
 * chapter types "give 5 points to everyone who came tonight" in the same
 * field a question goes in, and gets back a card that says exactly what
 * would happen and to whom. Nothing changes until they press Confirm. Web's
 * twin is `apps/web/components/ask/ask-proposal.tsx`; both read the same
 * stream (`useAsk`) and the same words (`ACT_COPY`).
 *
 * **A card to confirm, in the thread where it was asked.** Siri and
 * Shortcuts answer a spoken request with the thing filled in and a Confirm
 * before anything is sent, and Apple's Reminders and Calendar suggestions
 * show what would be added before it is. The card here is that: the action
 * as a title, the size of a bulk change in words ("Give 5 points to 42
 * members"), each detail on its own line, and Confirm beside Cancel.
 *
 * **What can be fixed on the card is what a request leaves unsaid.** Who a
 * points change is for: take a member off, or add one a name did not find,
 * from a roster to search (a chapter is a hundred members, so it is a tall
 * sheet with a search field, not a menu). A task opens the ordinary task
 * form on the proposal, the same door a suggested task has
 * (`suggested-tasks.tsx`), so who, when and the steps are changed where an
 * officer already changes them. Everything else is said again in other
 * words: the conversation carries what was typed before.
 *
 * **Every card in the thread stays live.** A card is not replaced by the
 * next thing asked. Once it is confirmed or dismissed it becomes one line
 * saying so, in the card's own frame, with a way to where the change shows.
 *
 * **Nothing above moves while it works.** Confirm and Cancel keep their
 * words while they save.
 *
 * **Fixed gold, never the chapter accent**, as the rest of the Ask sheet
 * (`components.md` §11): nothing here reaches `useChapterBranding()`.
 */

/** Where a finished change can be seen. */
export type ActLink = { href: "/tasks" | "/events"; label: string };

/**
 * Where a confirmed change can be seen, by the page the card named. The
 * phone has no points page to open (`notifications/targets.ts`).
 */
const RESULT_LINKS: Record<string, ActLink> = {
  tasks: { href: "/tasks", label: ACT_COPY.open_tasks },
  events: { href: "/events", label: ACT_COPY.open_events },
};

/**
 * The members an officer left on each points card, by proposal. The sheet
 * holds it, not the card: the card unmounts when the sheet closes, and a
 * list that quietly went back to the first one would give points to someone
 * the officer had taken off.
 */
export type KeptTargets = Readonly<Record<string, readonly string[]>>;

type Reporting = ReturnType<typeof useAiReport>;

export function AskProposal({
  proposal,
  resolution,
  kept,
  onKeep,
  report,
  onProposal,
  onResolved,
  onOpen,
}: {
  /** What the server answered the member's words with. */
  proposal: ActResponse;
  /** Set once the card was confirmed or dismissed. */
  resolution: AskProposalResolution | null;
  kept: KeptTargets;
  onKeep: (suggestionId: string, targets: string[]) => void;
  report: Reporting;
  /** The event pick answered with a new proposal for this turn. */
  onProposal: (proposal: ActResponse) => void;
  onResolved: (resolution: AskProposalResolution) => void;
  /** Leaves the sheet for the screen a finished change shows on. */
  onOpen: (link: ActLink) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const audience = useActEventAudience();
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (resolution) {
    const headline = proposalHeadline(proposal);
    const link =
      resolution.kind === "done"
        ? (RESULT_LINKS[resolution.page ?? ""] ?? null)
        : null;
    return (
      <View style={styles.card}>
        {headline ? <Text style={styles.headline}>{headline}</Text> : null}
        <Text style={styles.muted}>
          {resolutionLine(resolution)}
        </Text>
        {link ? (
          <QuietButton
            label={link.label}
            onPress={() => onOpen(link)}
            styles={styles}
          />
        ) : null}
      </View>
    );
  }

  async function pickEvent(eventId: string) {
    const choice = proposal.event_choice;
    if (!choice || picking) return;
    setProblem(null);
    setPicking(true);
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
    } finally {
      setPicking(false);
    }
  }

  return (
    <View style={styles.block}>
      <ActAnswer
        response={proposal}
        busy={picking}
        kept={kept}
        onKeep={onKeep}
        report={report}
        onPickEvent={(eventId) => void pickEvent(eventId)}
        onDone={(line, page) => onResolved({ kind: "done", line, page })}
        onCancelled={() => onResolved({ kind: "cancelled" })}
        onGone={() => onResolved({ kind: "gone" })}
        styles={styles}
      />
      {problem ? (
        <Text accessibilityRole="alert" style={styles.problem}>
          {problem}
        </Text>
      ) : null}
    </View>
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

type Styles = ReturnType<typeof createStyles>;

function QuietButton({
  label,
  onPress,
  disabled = false,
  styles,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      // 36pt drawn against the 44pt minimum.
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quiet,
        pressed ? styles.pressed : null,
        disabled ? styles.dimmed : null,
      ]}
    >
      <Text style={styles.quietText}>{label}</Text>
    </Pressable>
  );
}

function ActAnswer({
  response,
  busy,
  kept,
  onKeep,
  report,
  onPickEvent,
  onDone,
  onCancelled,
  onGone,
  styles,
}: {
  response: ActResponse;
  /** An event pick is on its way: the choices wait. */
  busy: boolean;
  kept: KeptTargets;
  onKeep: (suggestionId: string, targets: string[]) => void;
  report: Reporting;
  onPickEvent: (eventId: string) => void;
  onDone: (line: string, page: string) => void;
  onCancelled: () => void;
  /** The proposal stopped waiting before the member decided. */
  onGone: () => void;
  styles: Styles;
}) {
  if (response.status === "proposed" && response.suggestion) {
    return (
      <ActCard
        // A new proposal starts from its own members and fields.
        key={response.suggestion.id}
        suggestion={response.suggestion}
        notes={response.notes}
        kept={kept[response.suggestion.id] ?? null}
        onKeep={onKeep}
        report={report}
        onDone={onDone}
        onCancelled={onCancelled}
        onGone={onGone}
        styles={styles}
      />
    );
  }
  if (response.status === "needs_event" && response.event_choice) {
    const { events } = response.event_choice;
    if (events.length === 0) {
      return <Text style={styles.body}>{ACT_COPY.no_recent_events}</Text>;
    }
    return (
      <>
        <Text style={styles.strong}>{ACT_COPY.pick_event}</Text>
        {events.map((event) => {
          const when = actWhenLine(event.start_time, "");
          return (
            <Pressable
              key={event.id}
              accessibilityRole="button"
              accessibilityLabel={`${event.name}. ${when}`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => onPickEvent(event.id)}
              style={({ pressed }) => [
                styles.choice,
                pressed ? styles.pressed : null,
                busy ? styles.dimmed : null,
              ]}
            >
              <Text style={styles.choiceText}>{event.name}</Text>
              <Text style={styles.caption}>{when}</Text>
            </Pressable>
          );
        })}
      </>
    );
  }
  if (response.status === "no_action") {
    const labels = response.available_actions.flatMap((action) => {
      const label = actActionLabel(action);
      return label ? [label] : [];
    });
    return (
      <>
        <Text style={styles.body}>{ACT_COPY.no_action}</Text>
        {labels.length > 0 ? (
          <View>
            <Text style={styles.muted}>{ACT_COPY.no_action_can}</Text>
            {labels.map((label) => (
              <Text key={label} style={styles.muted}>
                {`• ${label}`}
              </Text>
            ))}
          </View>
        ) : null}
      </>
    );
  }
  // `unclear`. A card is never `unavailable` or `refused`: those end a turn
  // as an answer, and an event pick that may not run is an error, not a card.
  return <Text style={styles.body}>{actMissingLine(response.missing)}</Text>;
}

/** The proposal is no longer waiting: a day passed, or it was decided elsewhere. */
function isGone(error: unknown): boolean {
  return [
    "ai.suggestion.decided",
    "ai.suggestion.expired",
    "ai.suggestion.not_found",
  ].includes(codeOf(error) ?? "");
}

/** What a card that ended says in its place. */
function resolutionLine(resolution: AskProposalResolution): string {
  if (resolution.kind === "done") return resolution.line;
  return resolution.kind === "gone" ? ACT_COPY.gone : ACT_COPY.cancelled;
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
  styles,
}: {
  label: string;
  children: ReactNode;
  styles: Styles;
}) {
  return (
    <View style={styles.cardRow}>
      <Text style={styles.eyebrow}>{label}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

/** A task's due day written out, with its time when it has one. */
function dueLine(task: { due_date: string | null; due_at: string | null }) {
  const day = meetingDueLabel(task.due_date);
  if (!day || !task.due_at) return day;
  const at = new Date(task.due_at);
  if (Number.isNaN(at.getTime())) return day;
  return `${day}, ${at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function ActCard({
  suggestion,
  notes,
  kept,
  onKeep,
  report,
  onDone,
  onCancelled,
  onGone,
  styles,
}: {
  suggestion: AiSuggestion;
  notes: ActResponse["notes"];
  /** The members the officer left on this card, or null for the proposal's own. */
  kept: readonly string[] | null;
  onKeep: (suggestionId: string, targets: string[]) => void;
  report: Reporting;
  onDone: (line: string, page: string) => void;
  onCancelled: () => void;
  /** The proposal stopped waiting before the member decided. */
  onGone: () => void;
  styles: Styles;
}) {
  const { tokens } = useFrappTheme();
  const accept = useAcceptAiSuggestion();
  const dismiss = useDismissAiSuggestion();
  const rosterQuery = useChapterRoster();
  const me = (useCurrentUser().data as { id?: string } | undefined)?.id ?? null;
  const roster = useMemo(
    () =>
      (rosterQuery.data ?? []).map((row) => ({
        userId: row.user_id,
        name: row.display_name.trim().length > 0 ? row.display_name : null,
      })),
    [rosterQuery.data],
  );
  const nameOf = (userId: string) => {
    const member = roster.find((row) => row.userId === userId);
    if (member) return member.name ?? memberFallbackLabel(userId);
    // Until the roster is read, a blank; after, whoever is not on it left.
    return rosterQuery.isSuccess ? ACT_COPY.former_member : "";
  };

  const { points, task, new_event: event } = suggestion;
  const proposed = points?.target_user_ids;
  const targets = useMemo(() => [...(kept ?? proposed ?? [])], [kept, proposed]);
  const setTargets = (change: (list: string[]) => string[]) =>
    onKeep(suggestion.id, change(targets));
  // A Confirm or Cancel is out: the card's controls wait for it.
  const [deciding, setDeciding] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  // Confirm pressed with nobody left: say so, on the card.
  const [flagged, setFlagged] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const formRef = useRef<BottomSheetModal>(null);
  const pickerRef = useRef<BottomSheetModal>(null);
  useEffect(() => {
    if (formOpen) formRef.current?.present();
  }, [formOpen]);
  const busy = accept.isPending || dismiss.isPending || deciding;

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
    let edits: { points?: PointsSuggestionEdits } = {};
    if (points) {
      if (targets.length === 0) {
        setFlagged(true);
        return;
      }
      const changed =
        targets.length !== points.target_user_ids.length ||
        targets.some((id) => !points.target_user_ids.includes(id));
      if (changed) edits = { points: { target_user_ids: targets } };
    }
    if (task && (!task.assignee_id || !task.due_date)) {
      // A task needs who and when; the form is where the officer says them.
      setFormOpen(true);
      return;
    }
    setDeciding(true);
    try {
      const decision = await accept.mutateAsync({ id: suggestion.id, ...edits });
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
      // A card that stopped waiting says so in its place, with no buttons.
      if (isGone(error)) onGone();
      else setProblem(refusalLine(error));
    } finally {
      setDeciding(false);
    }
  }

  async function cancel() {
    setProblem(null);
    setDeciding(true);
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
    } finally {
      setDeciding(false);
    }
    onCancelled();
  }

  const addable = roster.filter(
    (member) => member.userId !== me && !targets.includes(member.userId),
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
      <View style={styles.notes}>
        {noteLines.map((line) => (
          <Text key={line} style={styles.noteLine}>
            {line}
          </Text>
        ))}
      </View>
    ) : null;

  const reportTarget = {
    subject: "ai_suggestion" as const,
    subjectId: suggestion.id,
  };
  const reported = report.offered && report.isReported(reportTarget);
  const membersOpen = showMembers || targets.length <= 5;

  const seed: TaskSuggestionSeed | undefined = task
    ? {
        title: task.title,
        assigneeId: task.assignee_id,
        dueDay: task.due_date,
        dueAt: task.due_at,
        subtasks: task.subtasks,
        accept: async (form) => {
          setDeciding(true);
          try {
            await accept.mutateAsync({
              id: suggestion.id,
              task: suggestionEdits(task, form),
            });
          } finally {
            setDeciding(false);
          }
          onDone(ACT_COPY.done_task, "tasks");
        },
      }
    : undefined;

  return (
    <View accessibilityLabel={title} style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.eyebrow}>{title}</Text>
        {/* Report this (#4315): what the agent proposed, for the Frapp team. */}
        {report.offered ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              reported
                ? AI_REPORT_COPY.reported
                : `${AI_REPORT_COPY.action}: ${title}`
            }
            accessibilityState={reported ? { disabled: true } : undefined}
            disabled={reported}
            hitSlop={12}
            onPress={() => report.report(reportTarget)}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <Text style={styles.caption}>
              {reported ? AI_REPORT_COPY.reported : AI_REPORT_COPY.action}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {points ? (
        <>
          <View>
            <Text style={styles.headline}>
              {actPointsHeadline(points.amount, targets.length)}
            </Text>
            {/* One line high with or without it, so removing down to one
                member moves nothing. */}
            <Text style={[styles.caption, styles.oneLine]}>
              {actPointsTotalLine(points.amount, targets.length)}
            </Text>
          </View>
          <CardRow label={ACT_COPY.field_reason} styles={styles}>
            {points.reason}
          </CardRow>
          {points.event_name ? (
            <CardRow label={ACT_COPY.field_attendance} styles={styles}>
              {actAttendanceLine(points.event_name, points.event_start_time)}
            </CardRow>
          ) : null}
          {notesStrip}
          {targets.length > 0 ? (
            <View style={styles.cardRow}>
              <View style={styles.cardHead}>
                <Text style={styles.eyebrow}>{ACT_COPY.field_members}</Text>
                {targets.length > 5 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: membersOpen }}
                    hitSlop={12}
                    onPress={() => setShowMembers((shown) => !shown)}
                    style={({ pressed }) => (pressed ? styles.pressed : null)}
                  >
                    <Text style={styles.captionStrong}>
                      {membersOpen
                        ? ACT_COPY.hide_members
                        : ACT_COPY.show_members}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {membersOpen ? (
                <View style={styles.members}>
                  {targets.map((userId, index) => {
                    const name = nameOf(userId);
                    return (
                      <View
                        key={userId}
                        style={[
                          styles.member,
                          index > 0 ? styles.memberDivided : null,
                        ]}
                      >
                        <Text numberOfLines={1} style={styles.memberName}>
                          {name}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${ACT_COPY.remove_member} ${name}`}
                          accessibilityState={{ disabled: busy }}
                          disabled={busy}
                          onPress={() =>
                            setTargets((list) =>
                              list.filter((other) => other !== userId),
                            )
                          }
                          style={({ pressed }) => [
                            styles.remove,
                            pressed ? styles.pressed : null,
                          ]}
                        >
                          <CloseGlyph
                            size={14}
                            color={tokens.color.text.mutedForeground}
                          />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}
          {addable.length > 0 ? (
            <QuietButton
              label={ACT_COPY.add_member}
              disabled={busy}
              onPress={() => pickerRef.current?.present()}
              styles={styles}
            />
          ) : null}
          {flagged && targets.length === 0 ? (
            <Text accessibilityRole="alert" style={styles.problem}>
              {ACT_COPY.no_members}
            </Text>
          ) : null}
        </>
      ) : null}

      {task ? (
        <>
          <Text style={styles.headline}>{task.title}</Text>
          {task.description ? (
            <Text style={styles.muted}>{task.description}</Text>
          ) : null}
          {notesStrip}
          {/* Who and when open the task form on this proposal, where an
              officer already sets them. */}
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the task form to change it."
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => setFormOpen(true)}
            style={({ pressed }) => [
              styles.taskFields,
              pressed ? styles.pressed : null,
            ]}
          >
            <View style={styles.cardRow}>
              <Text style={styles.eyebrow}>{ACT_COPY.field_for}</Text>
              <Text style={task.assignee_id ? styles.body : styles.missing}>
                {task.assignee_id
                  ? nameOf(task.assignee_id)
                  : ACT_COPY.pick_member}
              </Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.eyebrow}>{ACT_COPY.field_due}</Text>
              <Text style={task.due_date ? styles.body : styles.missing}>
                {task.due_date ? dueLine(task) : ACT_COPY.pick_due}
              </Text>
            </View>
          </Pressable>
        </>
      ) : null}

      {event ? (
        <>
          <Text style={styles.headline}>{event.name}</Text>
          <CardRow label={ACT_COPY.field_when} styles={styles}>
            {actWhenLine(event.start_time, event.end_time)}
          </CardRow>
          {event.location ? (
            <CardRow label={ACT_COPY.field_where} styles={styles}>
              {event.location}
            </CardRow>
          ) : null}
          <CardRow label={ACT_COPY.field_attendance} styles={styles}>
            {event.is_mandatory ? ACT_COPY.required : ACT_COPY.optional}
          </CardRow>
          <CardRow label={ACT_COPY.field_points} styles={styles}>
            {event.point_value === null
              ? ACT_COPY.default_points
              : String(event.point_value)}
          </CardRow>
          {event.description ? (
            <Text style={styles.muted}>{event.description}</Text>
          ) : null}
        </>
      ) : null}

      <Text style={styles.caption}>
        {points
          ? ACT_COPY.points_push
          : task
            ? ACT_COPY.task_push
            : ACT_COPY.event_push}{" "}
        {ACT_COPY.mine_only}
      </Text>

      {problem ? (
        <Text accessibilityRole="alert" style={styles.problem}>
          {problem}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <QuietButton
          label={ACT_COPY.cancel}
          disabled={busy}
          onPress={() => void cancel()}
          styles={styles}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ACT_COPY.confirm}
          accessibilityState={{ disabled: busy, busy: accept.isPending }}
          disabled={busy}
          hitSlop={4}
          onPress={() => void confirm()}
          style={({ pressed }) => [
            styles.confirm,
            pressed ? styles.pressed : null,
            busy ? styles.dimmed : null,
          ]}
        >
          {/* The same word while it saves, so the button keeps its width. */}
          <Text style={styles.confirmText}>{ACT_COPY.confirm}</Text>
        </Pressable>
      </View>

      {points ? (
        <MemberPickerSheet
          ref={pickerRef}
          members={addable}
          loading={rosterQuery.isPending}
          onPick={(userId) => {
            setTargets((list) =>
              list.includes(userId) ? list : [...list, userId],
            );
            setFlagged(false);
          }}
        />
      ) : null}
      {formOpen && seed ? (
        <NewTaskSheet
          ref={formRef}
          suggestion={seed}
          onClosed={() => setFormOpen(false)}
        />
      ) : null}
    </View>
  );
}

interface PickerMember {
  userId: string;
  name: string | null;
}

/**
 * The roster to add one member from: a tall sheet with a search field
 * (`components.md` § Surface size), as the task form's "Assign to" is. A
 * pick closes it.
 */
const MemberPickerSheet = forwardRef<
  BottomSheetModal,
  {
    members: readonly PickerMember[];
    loading: boolean;
    onPick: (userId: string) => void;
  }
>(function MemberPickerSheet({ members, loading, onPick }, ref) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const tall = useTallSheetProps();
  const close = useSheetClose(ref);
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const named = members.map((member) => ({
      userId: member.userId,
      label: member.name ?? memberFallbackLabel(member.userId),
    }));
    return needle
      ? named.filter((member) => member.label.toLowerCase().includes(needle))
      : named;
  }, [members, search]);

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tall}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => setSearch("")}
    >
      <SheetBackToClose onClose={close} />
      <BottomSheetFlatList
        onAccessibilityEscape={close}
        data={shown}
        keyExtractor={(row: { userId: string; label: string }) => row.userId}
        contentContainerStyle={styles.pickerContent}
        keyboardShouldPersistTaps="handled"
        // The title and search stay pinned while the roster scrolls.
        stickyHeaderIndices={[0]}
        ListHeaderComponent={
          <View style={styles.pickerHeader}>
            <TallSheetHeader title={ACT_COPY.add_member} onClose={close} />
            <BottomSheetTextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search members"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Search members"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.pickerField}
            />
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.pickerEmpty}>
            {loading ? "Loading your chapter…" : "No members match that search."}
          </Text>
        }
        renderItem={({ item }: { item: { userId: string; label: string } }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={() => {
              onPick(item.userId);
              close();
            }}
            style={({ pressed }) => [
              styles.pickerRow,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text numberOfLines={1} style={styles.body}>
              {item.label}
            </Text>
          </Pressable>
        )}
      />
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  const caption = typeRole(tokens.typography.role.caption);
  const gold = tokens.color.gold;
  return StyleSheet.create({
    block: {
      gap: tokens.spacing.sm,
      alignItems: "stretch",
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    strong: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    muted: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    caption: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
    captionStrong: {
      ...caption,
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.mutedForeground,
    },
    oneLine: {
      minHeight: caption.lineHeight ?? 18,
    },
    eyebrow: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.mutedForeground,
    },
    choice: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    choiceText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    quiet: {
      height: 36,
      alignSelf: "flex-start",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
    },
    quietText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.md,
      gap: tokens.spacing.md,
    },
    cardHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    cardRow: {
      gap: tokens.spacing.xs,
    },
    headline: {
      ...typeRole(tokens.typography.role.body),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    notes: {
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      gap: tokens.spacing.xs,
    },
    noteLine: {
      ...caption,
      color: tokens.color.text.foreground,
    },
    members: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    member: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: tokens.touch.minimum,
      paddingLeft: tokens.spacing.md,
    },
    memberDivided: {
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
    },
    memberName: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    remove: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    taskFields: {
      gap: tokens.spacing.md,
    },
    missing: {
      ...typeRole(tokens.typography.role.body),
      color: gold.askText,
    },
    problem: {
      ...caption,
      color: tokens.color.semantic.destructiveText,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: tokens.spacing.sm,
    },
    confirm: {
      height: 36,
      minWidth: 88,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      // House gold, fixed. Never the chapter accent on this surface.
      backgroundColor: gold.house,
    },
    confirmText: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: gold.onHouse,
    },
    pickerContent: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
    },
    pickerHeader: {
      backgroundColor: tokens.color.surface.popover,
      paddingBottom: tokens.spacing.sm,
      gap: tokens.spacing.sm,
    },
    pickerField: {
      ...sheetFieldStyles(tokens, gold.house).field,
    },
    pickerRow: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    pickerEmpty: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingVertical: tokens.spacing.lg,
    },
    pressed: { opacity: 0.7 },
    dimmed: { opacity: 0.5 },
  });
}

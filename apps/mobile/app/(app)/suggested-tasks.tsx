import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { codeOf } from "@repo/api-sdk";
import {
  dueEntryFromTask,
  formatDateEntry,
  lastYearBareDay,
  lastYearDay,
} from "@repo/formatting";
import {
  useAcceptAiSuggestion,
  useActiveChapterId,
  useAiSuggestions,
  useDismissAiSuggestion,
  useFrappClient,
  useMeetings,
  useMemberDisplayNames,
  useCurrentChapter,
  useSendAiSuggestionToNextAgenda,
  useUndoAiSuggestionNextAgenda,
  existingTaskLine,
  useSimilarTasks,
  type AiSuggestion,
  type AiSuggestionDismissReason,
  type ExistingTask,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_REPORT_COPY,
  AI_SUGGESTION_COPY,
  taskWhoOf,
  LAST_YEAR_COPY,
  SIMILAR_TASK_COPY,
  aiSuggestionRefusalLine,
  lastYearEventLine,
  isModuleEnabled,
  lastYearTaskLine,
  nextAgendaOutcomeLines,
} from "@repo/validation";
import {
  useAiReport,
  type AiReportTarget,
} from "@/components/ai/report-ai-sheet";
import { BACK_TO_TASKS } from "@/components/back-row";
import {
  BackGlyph,
  CloseGlyph,
  FlagGlyph,
  ForwardGlyph,
  ListGlyph,
  MoreGlyph,
  PencilGlyph,
  PersonGlyph,
} from "@/components/control-glyphs";
import {
  NewEventSheet,
  useCanCreateEvents,
} from "@/components/events/new-event-sheet";
import { InlineNote } from "@/components/inline-note";
import {
  useItemMenu,
  type ItemMenuAction,
  type ItemMenuHandle,
} from "@/components/item-actions-menu";
import { SectionHeader } from "@/components/list-section";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import {
  ErrorState,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import {
  NewTaskSheet,
  type TaskSuggestionSeed,
} from "@/components/tasks/new-task-sheet";
import { CalendarGlyph } from "@/components/tasks/task-glyphs";
import { useAiSurfaces } from "@/lib/ai/availability";
import { useChapterBranding } from "@/lib/chapter-branding";
import type { NewEventDraft } from "@/lib/events/create-event";
import { lastYearTemplate } from "@/lib/events/last-year-template";
import { selectEventDetail } from "@/lib/events/select";
import { suggestionEdits } from "@/lib/tasks/suggestion-edits";
import { useWhoDirectory } from "@/lib/tasks/use-who-directory";
import { whoLabel } from "@repo/hooks/task-who-picker";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";
import { focusReturnOf } from "@/lib/overlay";
import { pageSurfaces } from "@/lib/surfaces";

/**
 * Suggested tasks on the phone (#4313, `spec/behavior/meetings.md`
 * § Suggested tasks): the action items of posted minutes, each waiting for an
 * officer to accept it into a task, change it first, or dismiss it. Nothing
 * is a task until they do. It is where the "tasks were suggested" push
 * lands, and where the task board's one row and a meeting's minutes lead. Web
 * draws the same rows (`components/ai/suggested-tasks.tsx`).
 *
 * The secretary does this right after the meeting, from the notification, so
 * each card is decided in one tap, the way Linear's triage and Todoist's
 * task rows work on a phone. Each card is the same as web's (Paul,
 * 2026-11-19): the title and the line of the minutes, a who chip and a when
 * chip, Create task, and a worded ⋯ menu.
 *
 * - **Create task** makes the task as suggested when the minutes said who
 *   and when. When either is missing it opens the normal task form on the
 *   suggestion instead, since a task needs both.
 * - **The title or either chip** opens that same form, to change anything
 *   first. "Who?" and "When?" are muted while nothing is set, as web's are.
 * - **⋯** holds Change before creating, Dismiss and Report this.
 *
 * The server lists a suggestion only for someone who could accept it. A
 * decided row leaves the list; a refusal (another officer got there first)
 * says so under its row.
 *
 * ## This time last year (#3930, `spec/behavior/ai.md` § This time last year)
 *
 * The same list holds what the chapter did around now a year ago that this
 * year's record doesn't show: events, and finished tasks. A new president
 * meets these on the phone first, from the "This time last year" push, so
 * they are one section here rather than a screen of their own. Each says
 * what happened and asks to be corrected (`LAST_YEAR_COPY`), with three
 * answers, as Calendar's "Add to calendar" on an event found in Mail:
 *
 * - **Add to calendar** opens the ordinary New event form, filled in from
 *   last year's event on the same weekday this year. Nothing is added until
 *   the officer presses Create.
 * - **Already planned**, one tap.
 * - **Not this year**. Either of the last two and it does not come back.
 *
 * ## A task the chapter already has (#5562)
 *
 * A suggestion that reads like an open task (`similar-task.ts`) sets the two
 * side by side and asks which it is, as web's card does: **Already a task**
 * records the existing task as the suggestion's, so its action item follows
 * it; **Create anyway** brings back the usual row; Dismiss stays.
 */

/** Which of a row's answers is being sent. */
type Doing = "accept" | "dismiss" | "already" | "keep";

type SuggestedTask = NonNullable<AiSuggestion["task"]>;
type Waiting = AiSuggestion & { task: SuggestedTask };

function isWaitingTask(item: AiSuggestion): item is Waiting {
  return item.kind === "task" && item.task !== null;
}

type SuggestedEvent = NonNullable<AiSuggestion["event"]>;
type WaitingEvent = AiSuggestion & { event: SuggestedEvent };

function isWaitingEvent(item: AiSuggestion): item is WaitingEvent {
  return item.kind === "event" && item.event != null;
}

/** A task drawn from last year's board, not from a meeting's minutes. */
function isFromLastYear(item: Waiting): boolean {
  return !!item.task.last_year_on;
}

export default function SuggestedTasksScreen() {
  // Every way in is drawn only where the server has AI; this catches one
  // that skips them, such as an old notification after AI was turned off.
  const available = useAiSurfaces().available;
  if (available === false) return <Redirect href="/tasks" />;
  return <SuggestedTasks />;
}

function SuggestedTasks() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const params = useLocalSearchParams<{ meetingId?: string | string[] }>();
  const meetingId = Array.isArray(params.meetingId)
    ? params.meetingId[0]
    : params.meetingId;

  const suggestionsQuery = useAiSuggestions(
    meetingId ? { source: { type: "meeting", id: meetingId } } : undefined,
  );
  const tasks = useMemo(
    () => (suggestionsQuery.data?.items ?? []).filter(isWaitingTask),
    [suggestionsQuery.data],
  );
  // From the minutes, in groups; from last year, in their own section.
  const items = useMemo(
    () => tasks.filter((item) => !isFromLastYear(item)),
    [tasks],
  );
  const lastYearTasks = useMemo(() => tasks.filter(isFromLastYear), [tasks]);
  // Events are never listed for one meeting's minutes.
  const events = useMemo(
    () =>
      meetingId
        ? []
        : (suggestionsQuery.data?.items ?? []).filter(isWaitingEvent),
    [suggestionsQuery.data, meetingId],
  );
  const canCreateEvents = useCanCreateEvents();
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  // The names of the minutes each group came from. Only read when there is
  // a group to name.
  const meetingsQuery = useMeetings({
    enabled: items.some((item) => item.source.type === "meeting"),
  });
  const names = useMemberDisplayNames();
  // Roles and groups by name, for a suggestion for one ("Everyone in
  // Recruitment Committee", "Someone in Philanthropy Committee").
  const { directory } = useWhoDirectory();
  const accept = useAcceptAiSuggestion();
  const dismiss = useDismissAiSuggestion();
  const toNextAgenda = useSendAiSuggestionToNextAgenda();
  const undoNextAgenda = useUndoAiSuggestionNextAgenda();
  // The next meeting's Suggested list lives on events (#5790): offered only
  // once the chapter is read and has Events on.
  const chapterQuery = useCurrentChapter();
  const eventsOn =
    chapterQuery.data !== undefined &&
    isModuleEnabled(chapterQuery.data?.enabled_modules, "events");
  const refresh = useRefetchAll([suggestionsQuery]);
  const reporting = useAiReport();
  const itemMenu = useItemMenu();

  const [busy, setBusy] = useState<{ id: string; doing: Doing } | null>(null);
  // Why a row's last press didn't go through, shown under that row.
  const [problems, setProblems] = useState<Record<string, string>>({});
  // A refusal that means the row is gone (someone else decided it, it
  // expired, its minutes changed). The list reads again and drops the row, so
  // the reason is said above the list, by title, where it outlives the row:
  // a row that just vanished would read as "accepted".
  const [gone, setGone] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<Waiting | null>(null);
  const formRef = useRef<BottomSheetModal>(null);
  useEffect(() => {
    if (formFor) formRef.current?.present();
  }, [formFor]);
  // The event form, open on one suggestion's template.
  const [planFor, setPlanFor] = useState<{
    suggestionId: string;
    template: NewEventDraft;
  } | null>(null);
  const eventFormRef = useRef<BottomSheetModal>(null);
  useEffect(() => {
    if (planFor) eventFormRef.current?.present();
  }, [planFor]);
  // Said once an event was added from a suggestion, where the row was.
  const [added, setAdded] = useState(false);
  // Said once a suggestion went to the next meeting's agenda (#5790): where
  // it went, with Undo.
  const [sentOn, setSentOn] = useState<{
    id: string;
    line: string;
    meetingId: string | null;
  } | null>(null);
  // The open task each suggestion reads like, from the tasks this officer
  // can see (#5562).
  const similar = useSimilarTasks(tasks);

  const groups = useMemo(() => {
    const bySource = new Map<string, Waiting[]>();
    for (const item of items) {
      const key = `${item.source.type}:${item.source.id}`;
      bySource.set(key, [...(bySource.get(key) ?? []), item]);
    }
    return [...bySource.values()];
  }, [items]);

  // One card at a time (Paul, 2026-11-19: "one at a time actually"), as on
  // web: the minutes' in their order, then last year's. Deciding one leaves
  // the place where it is, so the next one takes its place.
  const queue = useMemo(
    () => [...groups.flat(), ...lastYearTasks],
    [groups, lastYearTasks],
  );
  const [index, setIndex] = useState(0);
  const at = Math.min(index, Math.max(queue.length - 1, 0));
  const current = queue[at] ?? null;

  function meetingName(id: string): string {
    return (
      meetingsQuery.data?.find((meeting) => meeting.id === id)?.event_name ??
      AI_SUGGESTION_COPY.meetingFallback
    );
  }

  function fail(item: Waiting | WaitingEvent, error: unknown) {
    const refusal = aiSuggestionRefusalLine(codeOf(error));
    if (refusal) {
      const name = item.task ? item.task.title : item.event?.name;
      setGone(`“${name ?? ""}”: ${refusal}`);
      return;
    }
    setProblems((previous) => ({
      ...previous,
      [item.id]: errorCopy(error, AI_SUGGESTION_COPY.tryAgain),
    }));
  }

  async function acceptRow(item: Waiting) {
    // A task needs who and when; the form is where the officer says them.
    if (!taskWhoOf(item.task) || !item.task.due_date) {
      setFormFor(item);
      return;
    }
    setGone(null);
    setBusy({ id: item.id, doing: "accept" });
    try {
      await accept.mutateAsync({ id: item.id });
    } catch (error) {
      fail(item, error);
    } finally {
      setBusy(null);
    }
  }

  /** Already a task: the suggestion is that task, and its item follows it. */
  async function linkRow(item: Waiting, existing: ExistingTask) {
    setGone(null);
    setBusy({ id: item.id, doing: "already" });
    try {
      await accept.mutateAsync({
        id: item.id,
        task: { existing_task_id: existing.id },
      });
    } catch (error) {
      fail(item, error);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Add to next meeting's agenda (#5790; Shawn, 2026-11-20): the action item
   * goes onto the next meeting with the same people, or under Suggested there
   * when the officer can't edit it, or waits for that meeting to be created.
   * The note above the list says which, with Undo and the meeting to open.
   */
  async function sendToNextAgenda(item: Waiting) {
    setGone(null);
    setAdded(false);
    setSentOn(null);
    setBusy({ id: item.id, doing: "dismiss" });
    try {
      const outcome = await toNextAgenda.mutateAsync(item.id);
      const lines = nextAgendaOutcomeLines(outcome);
      setSentOn({
        id: item.id,
        line: lines.body ? `${lines.title}. ${lines.body}` : `${lines.title}.`,
        meetingId: outcome.meeting?.id ?? null,
      });
    } catch (error) {
      fail(item, error);
    } finally {
      setBusy(null);
    }
  }

  /** The note's links after a send: the meeting it went to, then Undo. */
  function sentActions(sent: { id: string; meetingId: string | null }) {
    const undo = {
      label: AI_SUGGESTION_COPY.undo,
      onPress: () => {
        setSentOn(null);
        undoNextAgenda
          .mutateAsync(sent.id)
          .catch((error: unknown) =>
            setGone(
              `${AI_SUGGESTION_COPY.undoFailed}: ${
                aiSuggestionRefusalLine(codeOf(error)) ??
                AI_SUGGESTION_COPY.tryAgain
              }`,
            ),
          );
      },
    };
    const { meetingId } = sent;
    if (!meetingId) return [undo];
    return [
      {
        label: AI_SUGGESTION_COPY.toAgendaOpen,
        onPress: () =>
          router.push({
            pathname: "/event-details",
            params: { id: meetingId },
          }),
      },
      undo,
    ];
  }

  async function dismissRow(
    item: Waiting | WaitingEvent,
    reason?: AiSuggestionDismissReason,
  ) {
    setGone(null);
    setAdded(false);
    setSentOn(null);
    setBusy({ id: item.id, doing: reason ? "already" : "dismiss" });
    try {
      await dismiss.mutateAsync({ id: item.id, reason });
    } catch (error) {
      fail(item, error);
    } finally {
      setBusy(null);
    }
  }

  async function plan(item: WaitingEvent) {
    setGone(null);
    setAdded(false);
    setProblems((previous) => {
      const rest = { ...previous };
      delete rest[item.id];
      return rest;
    });
    setBusy({ id: item.id, doing: "accept" });
    try {
      // Last year's event, read as this officer: the same read the event's
      // own screen makes, so the form copies only what they may see.
      const source = await queryClient.fetchQuery({
        queryKey: ["events", chapterId, item.source.id],
        queryFn: async () => {
          const { data, error } = await client.GET("/v1/events/{id}", {
            params: { path: { id: item.source.id } },
          });
          if (error) throw error;
          return data;
        },
        staleTime: 30_000,
      });
      const detail = selectEventDetail(source);
      if (!detail) throw new Error("Last year's event could not be read.");
      setPlanFor({ suggestionId: item.id, template: lastYearTemplate(detail) });
    } catch {
      setProblems((previous) => ({
        ...previous,
        [item.id]: LAST_YEAR_COPY.openFailed,
      }));
    } finally {
      setBusy(null);
    }
  }

  const seed: TaskSuggestionSeed | undefined = formFor
    ? {
        title: formFor.task.title,
        // One member, several, a role, a group or everyone, each doing it
        // or one claiming it (2026-11-18).
        who: taskWhoOf(formFor.task),
        dueDay: formFor.task.due_date,
        dueAt: formFor.task.due_at,
        subtasks: formFor.task.subtasks,
        accept: async (form) => {
          await accept.mutateAsync({
            id: formFor.id,
            task: suggestionEdits(formFor.task, form),
          });
        },
      }
    : undefined;

  /** Who a suggestion names, in the picker's words, or `null` for nobody. */
  function suggestionWho(task: SuggestedTask): string | null {
    const who = taskWhoOf(task);
    if (!who) return null;
    if (who.kind === "person") {
      return memberLabel(names.nameFor(who.userId), who.userId);
    }
    return whoLabel(who, directory);
  }

  /**
   * A card's ⋯ menu, worded as web's is: Change before creating and, for one
   * from minutes, Add to next meeting's agenda (a card that isn't asking
   * about a twin), Dismiss, and Report this until it is sent.
   */
  function menuFor(item: Waiting, twin: boolean): ItemMenuHandle | null {
    const report = reportFor(item, reporting);
    const actions: ItemMenuAction[] = [];
    if (!twin) {
      actions.push({
        key: "change",
        label: AI_SUGGESTION_COPY.change,
        glyph: (color) => <PencilGlyph color={color} />,
        run: () => setFormFor(item),
      });
    }
    // As on web, not while the card asks whether it is an existing task.
    if (
      !twin &&
      eventsOn &&
      item.source.type === "meeting" &&
      !isFromLastYear(item)
    ) {
      actions.push({
        key: "next-agenda",
        label: AI_SUGGESTION_COPY.toAgenda,
        glyph: (color) => <ListGlyph color={color} />,
        run: () => void sendToNextAgenda(item),
      });
    }
    actions.push({
      key: "dismiss",
      label: AI_SUGGESTION_COPY.dismiss,
      glyph: (color) => <CloseGlyph color={color} />,
      run: () => void dismissRow(item),
    });
    if (report && !report.reported) {
      actions.push({
        key: "report",
        label: AI_REPORT_COPY.action,
        glyph: (color) => <FlagGlyph color={color} />,
        run: report.onPress,
      });
    }
    return itemMenu.handleFor({ title: item.task.title, actions });
  }

  const row = (item: Waiting) => (
    <SuggestionRow
      key={item.id}
      item={item}
      who={suggestionWho(item.task)}
      busy={busy?.id === item.id ? busy.doing : null}
      disabled={busy !== null}
      problem={problems[item.id] ?? null}
      onOpen={() => setFormFor(item)}
      onAccept={() => void acceptRow(item)}
      onAlreadyDoing={
        isFromLastYear(item)
          ? () => void dismissRow(item, "already_doing")
          : undefined
      }
      existing={similar.twinOf(item.id)}
      onSameTask={(existing) => void linkRow(item, existing)}
      onDifferentTask={() => similar.keep(item.id)}
      onOpenExisting={(id) =>
        router.push({ pathname: "/task-details", params: { id } })
      }
      menu={menuFor(item, similar.twinOf(item.id) !== null)}
      styles={styles}
    />
  );

  const waiting = items.length + lastYearTasks.length + events.length;

  return (
    <>
      <ScreenShell
        back={BACK_TO_TASKS}
        title={AI_SUGGESTION_COPY.listHeading}
        refresh={refresh}
      >
        {gone ? <InlineNote tone="warning">{gone}</InlineNote> : null}
        {added ? <InlineNote>{LAST_YEAR_COPY.eventAdded}</InlineNote> : null}
        {sentOn ? (
          <InlineNote action={sentActions(sentOn)}>{sentOn.line}</InlineNote>
        ) : null}
        {suggestionsQuery.isPending ? (
          <SuggestionsSkeleton />
        ) : suggestionsQuery.isError && !suggestionsQuery.data ? (
          <ErrorState
            title={AI_SUGGESTION_COPY.loadFailedTitle}
            body={AI_SUGGESTION_COPY.loadFailedBody}
            onRetry={() => void suggestionsQuery.refetch()}
            isRetrying={suggestionsQuery.isFetching}
          />
        ) : waiting === 0 ? (
          <InlineNote>{AI_SUGGESTION_COPY.empty}</InlineNote>
        ) : current ? (
          <View style={styles.group}>
            <View style={styles.pagerRow}>
              <SectionHeader count={queue.length}>
                {AI_SUGGESTION_COPY.heading}
              </SectionHeader>
              {queue.length > 1 ? (
                <Pager
                  at={at}
                  of={queue.length}
                  onMove={setIndex}
                  styles={styles}
                />
              ) : null}
            </View>
            {isFromLastYear(current) ? null : current.source.type ===
              "meeting" ? (
              <InlineNote
                action={{
                  label: meetingName(current.source.id),
                  onPress: () =>
                    router.push({
                      pathname: "/minutes-details",
                      params: { id: current.source.id },
                    }),
                }}
              >
                {AI_SUGGESTION_COPY.fromMinutesOf}
              </InlineNote>
            ) : (
              <InlineNote>
                {`${AI_SUGGESTION_COPY.fromMinutesOf} ${AI_SUGGESTION_COPY.aMeeting}`}
              </InlineNote>
            )}
            {row(current)}
          </View>
        ) : null}
        {events.length > 0 ? (
          <View style={styles.group}>
            <SectionHeader count={events.length}>
              {LAST_YEAR_COPY.heading}
            </SectionHeader>
            <InlineNote>{LAST_YEAR_COPY.intro}</InlineNote>
            {events.map((item) => (
              <LastYearEventRow
                key={item.id}
                item={item}
                busy={busy?.id === item.id ? busy.doing : null}
                disabled={busy !== null}
                canAdd={canCreateEvents}
                problem={problems[item.id] ?? null}
                onAdd={() => void plan(item)}
                onAlreadyDoing={() => void dismissRow(item, "already_doing")}
                onDismiss={() => void dismissRow(item)}
                report={reportFor(item, reporting)}
                styles={styles}
              />
            ))}
          </View>
        ) : null}
      </ScreenShell>
      {formFor && seed ? (
        <NewTaskSheet
          key={formFor.id}
          ref={formRef}
          suggestion={seed}
          offerGroups
          onClosed={() => setFormFor(null)}
        />
      ) : null}
      {planFor ? (
        <NewEventSheet
          key={planFor.suggestionId}
          ref={eventFormRef}
          template={planFor.template}
          onCreated={({ id }) => {
            const { suggestionId } = planFor;
            setPlanFor(null);
            setAdded(true);
            // The event is on the calendar whatever this does: if it doesn't
            // land, the weekly check sees the event and takes the suggestion
            // back, so a failure here is not the officer's to fix.
            if (id) {
              void accept
                .mutateAsync({ id: suggestionId, eventId: id })
                .catch(() => undefined);
            }
          }}
        />
      ) : null}
      {reporting.reportSheet}
      {itemMenu.element}
    </>
  );
}

/** "2 of 8" with previous and next, as web's card has them. */
function Pager({
  at,
  of,
  onMove,
  styles,
}: {
  at: number;
  of: number;
  onMove: (index: number) => void;
  styles: Styles;
}) {
  const { tokens } = useFrappTheme();
  const step = (
    label: string,
    to: number,
    enabled: boolean,
    glyph: ReactNode,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      hitSlop={4}
      onPress={() => onMove(to)}
      style={({ pressed }) => [
        styles.more,
        pressed ? styles.pressed : null,
        enabled ? null : styles.dimmed,
      ]}
    >
      {glyph}
    </Pressable>
  );
  const color = tokens.color.text.foreground;
  return (
    <View style={styles.pager}>
      <Text accessibilityLiveRegion="polite" style={styles.position}>
        {AI_SUGGESTION_COPY.position(at + 1, of)}
      </Text>
      {step(
        AI_SUGGESTION_COPY.previous,
        at - 1,
        at > 0,
        <BackGlyph color={color} />,
      )}
      {step(
        AI_SUGGESTION_COPY.next,
        at + 1,
        at < of - 1,
        <ForwardGlyph color={color} />,
      )}
    </View>
  );
}

/** A suggestion's "Report this", for a member who may report (#4315). */
function reportFor(
  item: Waiting | WaitingEvent,
  reporting: ReturnType<typeof useAiReport>,
) {
  if (!reporting.offered) return null;
  const target: AiReportTarget = {
    subject: "ai_suggestion",
    subjectId: item.id,
  };
  return {
    reported: reporting.isReported(target),
    onPress: () => reporting.report(target),
  };
}

type Styles = ReturnType<typeof createStyles>;

type RowReport = { reported: boolean; onPress: () => void } | null;

/**
 * A row's answers. The decisions sit on the right as buttons. A last-year
 * event has a third answer, so "Report this" and "Not this year" take a
 * quiet line of their own under the buttons rather than crowding four
 * controls into one; a suggested task's card keeps those in its ⋯ menu.
 * Every label keeps its words while it saves, so nothing changes width.
 */
function RowActions({
  name,
  busy,
  disabled,
  report,
  primary,
  secondary,
  quiet,
  styles,
}: {
  name: string;
  busy: Doing | null;
  disabled: boolean;
  report: RowReport;
  primary: { label: string; doing: Doing; onPress: () => void } | null;
  secondary?: { label: string; doing: Doing; onPress: () => void };
  quiet?: { label: string; doing: Doing; onPress: () => void };
  styles: Styles;
}) {
  const { accent, accentOnPrimary } = useChapterBranding();
  const reportLink = report ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        report.reported
          ? AI_REPORT_COPY.reported
          : `${AI_REPORT_COPY.action}: ${name}`
      }
      accessibilityState={report.reported ? { disabled: true } : undefined}
      disabled={report.reported}
      hitSlop={4}
      onPress={report.onPress}
      style={({ pressed }) => [styles.report, pressed ? styles.pressed : null]}
    >
      <Text style={styles.meta}>
        {report.reported ? AI_REPORT_COPY.reported : AI_REPORT_COPY.action}
      </Text>
    </Pressable>
  ) : null;

  return (
    <>
      <View style={styles.actions}>
        {quiet ? null : reportLink}
        {secondary ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${secondary.label}: ${name}`}
            accessibilityState={{ disabled, busy: busy === secondary.doing }}
            disabled={disabled}
            // 36pt drawn against the 44pt minimum.
            hitSlop={4}
            onPress={secondary.onPress}
            style={({ pressed }) => [
              styles.button,
              styles.dismiss,
              pressed ? styles.pressed : null,
              disabled && busy !== secondary.doing ? styles.dimmed : null,
            ]}
          >
            <Text style={styles.dismissText}>{secondary.label}</Text>
          </Pressable>
        ) : null}
        {primary ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${primary.label}: ${name}`}
            accessibilityState={{ disabled, busy: busy === primary.doing }}
            disabled={disabled}
            hitSlop={4}
            onPress={primary.onPress}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: accent },
              pressed ? styles.pressed : null,
              disabled && busy !== primary.doing ? styles.dimmed : null,
            ]}
          >
            <Text style={[styles.acceptText, { color: accentOnPrimary }]}>
              {primary.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {quiet ? (
        <View style={styles.quietRow}>
          {reportLink}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${quiet.label}: ${name}`}
            accessibilityState={{ disabled, busy: busy === quiet.doing }}
            disabled={disabled}
            hitSlop={4}
            onPress={quiet.onPress}
            style={({ pressed }) => [
              styles.quiet,
              pressed ? styles.pressed : null,
              disabled && busy !== quiet.doing ? styles.dimmed : null,
            ]}
          >
            <Text style={styles.meta}>{quiet.label}</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

function SuggestionRow({
  item,
  who,
  busy,
  disabled,
  problem,
  onOpen,
  onAccept,
  onAlreadyDoing,
  existing,
  onSameTask,
  onDifferentTask,
  onOpenExisting,
  menu,
  styles,
}: {
  item: Waiting;
  who: string | null;
  busy: Doing | null;
  disabled: boolean;
  problem: string | null;
  onOpen: () => void;
  onAccept: () => void;
  /** Set for a task drawn from last year's board, which has a third answer. */
  onAlreadyDoing?: () => void;
  /** The open task this suggestion reads like, until the officer says. */
  existing: ExistingTask | null;
  onSameTask: (existing: ExistingTask) => void;
  onDifferentTask: () => void;
  onOpenExisting: (id: string) => void;
  /** Change before creating, Dismiss, Report this. */
  menu: ItemMenuHandle | null;
  styles: Styles;
}) {
  const { tokens } = useFrappTheme();
  const { task } = item;
  if (existing) {
    return (
      <SimilarTaskRow
        item={item}
        existing={existing}
        busy={busy}
        disabled={disabled}
        problem={problem}
        onSame={() => onSameTask(existing)}
        onDifferent={onDifferentTask}
        onOpenExisting={() => onOpenExisting(existing.id)}
        menu={menu}
        styles={styles}
      />
    );
  }
  const due = task.due_date
    ? formatDateEntry(
        dueEntryFromTask({ due_date: task.due_date, due_at: task.due_at }),
        new Date(),
      )
    : null;
  const lastYear = task.last_year_on
    ? lastYearTaskLine(lastYearBareDay(task.last_year_on))
    : null;
  const muted = tokens.color.text.mutedForeground;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            lastYear ? `${task.title}. ${lastYear}` : task.title
          }
          accessibilityHint={AI_SUGGESTION_COPY.change}
          disabled={disabled}
          onPress={onOpen}
          style={({ pressed }) => [
            styles.cardText,
            styles.cardHeadText,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.title}>{task.title}</Text>
          {/* The line of the minutes, when the title had to be cut from it. */}
          {item.quote && item.quote !== task.title ? (
            <Text style={styles.meta} numberOfLines={3}>
              {`“${item.quote}”`}
            </Text>
          ) : null}
          {lastYear ? <Text style={styles.meta}>{lastYear}</Text> : null}
        </Pressable>
        <RowMenuButton
          name={task.title}
          menu={menu}
          disabled={disabled}
          styles={styles}
        />
      </View>
      {/*
       * Who and when as two chips, the way web's card shows them. Either
       * opens the task form on the suggestion, where both are set; "Who?"
       * and "When?" are muted while nothing is set.
       */}
      <View style={styles.chips}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Assignee for ${task.title}: ${who ?? AI_SUGGESTION_COPY.who}`}
          accessibilityHint={AI_SUGGESTION_COPY.change}
          disabled={disabled}
          hitSlop={6}
          onPress={onOpen}
          style={({ pressed }) => [
            styles.chip,
            pressed ? styles.pressed : null,
          ]}
        >
          <PersonGlyph color={muted} />
          <Text
            numberOfLines={1}
            style={[styles.chipText, who ? null : styles.chipTextEmpty]}
          >
            {who ?? AI_SUGGESTION_COPY.who}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Due date for ${task.title}: ${due ?? AI_SUGGESTION_COPY.when}`}
          accessibilityHint={AI_SUGGESTION_COPY.change}
          disabled={disabled}
          hitSlop={6}
          onPress={onOpen}
          style={({ pressed }) => [
            styles.chip,
            pressed ? styles.pressed : null,
          ]}
        >
          <CalendarGlyph color={muted} size={14} />
          <Text
            numberOfLines={1}
            style={[styles.chipText, due ? null : styles.chipTextEmpty]}
          >
            {due ?? AI_SUGGESTION_COPY.when}
          </Text>
        </Pressable>
      </View>
      <RowActions
        name={task.title}
        busy={busy}
        disabled={disabled}
        report={null}
        primary={{
          label: AI_SUGGESTION_COPY.accept,
          doing: "accept",
          onPress: onAccept,
        }}
        secondary={
          onAlreadyDoing
            ? {
                label: LAST_YEAR_COPY.alreadyDoing,
                doing: "already",
                onPress: onAlreadyDoing,
              }
            : undefined
        }
        styles={styles}
      />
      {problem ? (
        <Text accessibilityLiveRegion="polite" style={styles.problem}>
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

/** A card's ⋯, which opens its worded menu. */
function RowMenuButton({
  name,
  menu,
  disabled,
  styles,
}: {
  name: string;
  menu: ItemMenuHandle | null;
  disabled: boolean;
  styles: Styles;
}) {
  const { tokens } = useFrappTheme();
  if (!menu) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${AI_SUGGESTION_COPY.more}: ${name}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      // 36pt drawn against the 44pt minimum.
      hitSlop={4}
      // The button gets a screen reader's focus back when the menu closes.
      onPress={(event) =>
        menu.open(event?.nativeEvent?.pageY, focusReturnOf(event))
      }
      style={({ pressed }) => [
        styles.more,
        pressed ? styles.pressed : null,
        disabled ? styles.dimmed : null,
      ]}
    >
      <MoreGlyph color={tokens.color.text.foreground} />
    </Pressable>
  );
}

/**
 * A suggestion beside the open task it reads like (#5562): the two titles
 * side by side, where the existing one stands, and the one question. Web's
 * card (`SimilarTaskCard`) says the same in the same order.
 */
function SimilarTaskRow({
  item,
  existing,
  busy,
  disabled,
  problem,
  onSame,
  onDifferent,
  onOpenExisting,
  menu,
  styles,
}: {
  item: Waiting;
  existing: ExistingTask;
  busy: Doing | null;
  disabled: boolean;
  problem: string | null;
  onSame: () => void;
  onDifferent: () => void;
  onOpenExisting: () => void;
  /** Dismiss and Report this, as web's card has them. */
  menu: ItemMenuHandle | null;
  styles: Styles;
}) {
  const { task } = item;
  const where = existingTaskLine(existing);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={[styles.meta, styles.cardHeadText]}>
          {SIMILAR_TASK_COPY.heading}
        </Text>
        <RowMenuButton
          name={task.title}
          menu={menu}
          disabled={disabled}
          styles={styles}
        />
      </View>
      <View style={styles.compare}>
        <View style={styles.compareSide}>
          <Text style={styles.meta}>{SIMILAR_TASK_COPY.suggested}</Text>
          <Text style={styles.title}>{task.title}</Text>
          {item.quote && item.quote !== task.title ? (
            <Text style={styles.meta} numberOfLines={3}>
              {`“${item.quote}”`}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${SIMILAR_TASK_COPY.openExisting}: ${existing.title}`}
          onPress={onOpenExisting}
          style={({ pressed }) => [
            styles.compareSide,
            styles.compareExisting,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.meta}>{SIMILAR_TASK_COPY.existing}</Text>
          <Text style={styles.title}>{existing.title}</Text>
          {where ? <Text style={styles.meta}>{where}</Text> : null}
          <Text style={[styles.meta, styles.link]}>
            {SIMILAR_TASK_COPY.openExisting}
          </Text>
        </Pressable>
      </View>
      <RowActions
        name={task.title}
        busy={busy}
        disabled={disabled}
        report={null}
        primary={{
          label: SIMILAR_TASK_COPY.same,
          doing: "already",
          onPress: onSame,
        }}
        secondary={{
          label: SIMILAR_TASK_COPY.different,
          doing: "keep",
          onPress: onDifferent,
        }}
        styles={styles}
      />
      {problem ? (
        <Text accessibilityLiveRegion="polite" style={styles.problem}>
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * An event the chapter held around now last year. Nothing here opens on a
 * tap of the row: last year's event is not this year's, and "Add to
 * calendar" is the one way to look at it, in the form it would become.
 */
function LastYearEventRow({
  item,
  busy,
  disabled,
  canAdd,
  problem,
  onAdd,
  onAlreadyDoing,
  onDismiss,
  report,
  styles,
}: {
  item: WaitingEvent;
  busy: Doing | null;
  disabled: boolean;
  /** Whether this officer may create events at all. */
  canAdd: boolean;
  problem: string | null;
  onAdd: () => void;
  onAlreadyDoing: () => void;
  onDismiss: () => void;
  report: RowReport;
  styles: Styles;
}) {
  const { event } = item;
  const line = lastYearEventLine(lastYearDay(event.last_year_at), event.times);
  return (
    <View style={styles.card}>
      <View
        accessible
        accessibilityLabel={`${event.name}. ${line}`}
        style={styles.cardText}
      >
        <Text style={styles.title}>{event.name}</Text>
        <Text style={styles.meta}>{line}</Text>
      </View>
      <RowActions
        name={event.name}
        busy={busy}
        disabled={disabled}
        report={report}
        primary={
          canAdd
            ? {
                label: LAST_YEAR_COPY.addEvent,
                doing: "accept",
                onPress: onAdd,
              }
            : null
        }
        secondary={{
          label: LAST_YEAR_COPY.alreadyDoing,
          doing: "already",
          onPress: onAlreadyDoing,
        }}
        quiet={{
          label: LAST_YEAR_COPY.dismiss,
          doing: "dismiss",
          onPress: onDismiss,
        }}
        styles={styles}
      />
      {problem ? (
        <Text accessibilityLiveRegion="polite" style={styles.problem}>
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

function SuggestionsSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { label, caption } = tokens.typography.role;
  return (
    <SkeletonRegion label="Loading suggested tasks" style={styles.group}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.card}>
          <SkeletonText role={label} width={index === 1 ? "58%" : "72%"} />
          <SkeletonText role={caption} width="44%" />
          <View style={styles.skeletonActions} />
        </View>
      ))}
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    group: {
      gap: tokens.spacing.sm,
    },
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      padding: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    cardText: {
      gap: tokens.spacing.xs,
    },
    pagerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    pager: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    position: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
    cardHead: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.sm,
    },
    cardHeadText: {
      flex: 1,
      minWidth: 0,
    },
    more: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radius.control,
      // Level with the title's first line rather than below it.
      marginTop: -tokens.spacing.xs,
      marginRight: -tokens.spacing.xs,
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
    },
    chip: {
      flexShrink: 1,
      minWidth: 0,
      height: 32,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
    },
    chipText: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    chipTextEmpty: {
      color: tokens.color.text.mutedForeground,
    },
    compare: {
      flexDirection: "row",
      gap: tokens.spacing.md,
    },
    compareSide: {
      flex: 1,
      minWidth: 0,
      gap: tokens.spacing.xs,
    },
    compareExisting: {
      borderLeftWidth: 1,
      borderLeftColor: tokens.color.border.hairline,
      paddingLeft: tokens.spacing.md,
    },
    link: {
      textDecorationLine: "underline",
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: tokens.spacing.sm,
    },
    report: {
      height: 36,
      justifyContent: "center",
      // Takes the room left of Dismiss and Accept, which stay on the right.
      marginRight: "auto",
    },
    quietRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      // The two quiet answers read as one line, closer than the buttons.
      marginTop: -tokens.spacing.xs,
    },
    quiet: {
      height: 36,
      justifyContent: "center",
    },
    skeletonActions: {
      height: 36,
    },
    button: {
      height: 36,
      minWidth: 88,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
    },
    dismiss: {
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: surfaces.raised,
    },
    dismissText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    acceptText: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
    },
    problem: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
    pressed: {
      opacity: 0.7,
    },
    dimmed: {
      opacity: 0.5,
    },
  });
}

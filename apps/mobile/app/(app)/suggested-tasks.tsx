import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { codeOf } from "@repo/api-sdk";
import { lastYearBareDay, lastYearDay } from "@repo/formatting";
import {
  useAcceptAiSuggestion,
  useActiveChapterId,
  useAiSuggestions,
  useDismissAiSuggestion,
  useFrappClient,
  useMeetings,
  useMemberDisplayNames,
  type AiSuggestion,
  type AiSuggestionDismissReason,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_REPORT_COPY,
  AI_SUGGESTION_COPY,
  LAST_YEAR_COPY,
  aiSuggestionRefusalLine,
  lastYearEventLine,
  lastYearTaskLine,
  meetingDueLabel,
} from "@repo/validation";
import {
  useAiReport,
  type AiReportTarget,
} from "@/components/ai/report-ai-sheet";
import type { BackTarget } from "@/components/back-row";
import {
  NewEventSheet,
  useCanCreateEvents,
} from "@/components/events/new-event-sheet";
import { InlineNote } from "@/components/inline-note";
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
import { useAiSurfaces } from "@/lib/ai/availability";
import { useChapterBranding } from "@/lib/chapter-branding";
import type { NewEventDraft } from "@/lib/events/create-event";
import { lastYearTemplate } from "@/lib/events/last-year-template";
import { selectEventDetail } from "@/lib/events/select";
import { suggestionEdits } from "@/lib/tasks/suggestion-edits";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";
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
 * each row is decided in one tap, the way Gmail's and Linear's triage lists
 * work on a phone:
 *
 * - **Accept** makes the task as suggested when the minutes said who and
 *   when. When either is missing it opens the normal task form on the
 *   suggestion instead, since a task needs both.
 * - **Tapping the row** opens that same form, to change anything first.
 * - **Dismiss** takes it off the list.
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
 */
const BACK_TO_TASKS: BackTarget = { label: "Tasks", href: "/tasks" };

/** Which of a row's answers is being sent. */
type Doing = "accept" | "dismiss" | "already";

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
  const accept = useAcceptAiSuggestion();
  const dismiss = useDismissAiSuggestion();
  const refresh = useRefetchAll([suggestionsQuery]);
  const reporting = useAiReport();

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

  const groups = useMemo(() => {
    const bySource = new Map<string, Waiting[]>();
    for (const item of items) {
      const key = `${item.source.type}:${item.source.id}`;
      bySource.set(key, [...(bySource.get(key) ?? []), item]);
    }
    return [...bySource.values()];
  }, [items]);

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
    if (!item.task.assignee_id || !item.task.due_date) {
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

  async function dismissRow(
    item: Waiting | WaitingEvent,
    reason?: AiSuggestionDismissReason,
  ) {
    setGone(null);
    setAdded(false);
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
        assigneeId: formFor.task.assignee_id,
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

  const row = (item: Waiting) => (
    <SuggestionRow
      key={item.id}
      item={item}
      who={
        item.task.assignee_id
          ? memberLabel(
              names.nameFor(item.task.assignee_id),
              item.task.assignee_id,
            )
          : null
      }
      busy={busy?.id === item.id ? busy.doing : null}
      disabled={busy !== null}
      problem={problems[item.id] ?? null}
      onOpen={() => setFormFor(item)}
      onAccept={() => void acceptRow(item)}
      onDismiss={() => void dismissRow(item)}
      onAlreadyDoing={
        isFromLastYear(item)
          ? () => void dismissRow(item, "already_doing")
          : undefined
      }
      report={reportFor(item, reporting)}
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
        ) : (
          groups.map((group) => {
            const first = group[0]!;
            const fromMeeting = first.source.type === "meeting";
            return (
              <View key={`${first.source.type}:${first.source.id}`} style={styles.group}>
                {fromMeeting ? (
                  <InlineNote
                    action={{
                      label: meetingName(first.source.id),
                      onPress: () =>
                        router.push({
                          pathname: "/minutes-details",
                          params: { id: first.source.id },
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
                {group.map(row)}
              </View>
            );
          })
        )}
        {events.length + lastYearTasks.length > 0 ? (
          <View style={styles.group}>
            <SectionHeader count={events.length + lastYearTasks.length}>
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
            {lastYearTasks.map(row)}
          </View>
        ) : null}
      </ScreenShell>
      {formFor && seed ? (
        <NewTaskSheet
          key={formFor.id}
          ref={formRef}
          suggestion={seed}
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
    </>
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
 * A row's answers. The two decisions sit on the right as buttons. From the
 * minutes the quiet "Report this" shares their line; a last-year row has a
 * third answer, so "Report this" and "Not this year" take a quiet line of
 * their own under the buttons rather than crowding four controls into one.
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
  secondary: { label: string; doing: Doing; onPress: () => void };
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
  onDismiss,
  onAlreadyDoing,
  report,
  styles,
}: {
  item: Waiting;
  who: string | null;
  busy: Doing | null;
  disabled: boolean;
  problem: string | null;
  onOpen: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  /** Set for a task drawn from last year's board, which has a third answer. */
  onAlreadyDoing?: () => void;
  report: RowReport;
  styles: Styles;
}) {
  const { task } = item;
  const meta = [
    who ?? AI_SUGGESTION_COPY.who,
    task.due_date ? `Due ${meetingDueLabel(task.due_date)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const lastYear = task.last_year_on
    ? lastYearTaskLine(lastYearBareDay(task.last_year_on))
    : null;
  const accept = {
    label: AI_SUGGESTION_COPY.accept,
    doing: "accept" as const,
    onPress: onAccept,
  };
  const dismiss = {
    // "Dismiss" on a last-year task too, as web's row says it; "Not this
    // year" is an event's.
    label: AI_SUGGESTION_COPY.dismiss,
    doing: "dismiss" as const,
    onPress: onDismiss,
  };

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${task.title}. ${lastYear ?? meta}`}
        accessibilityHint={AI_SUGGESTION_COPY.change}
        disabled={disabled}
        onPress={onOpen}
        style={({ pressed }) => [styles.cardText, pressed ? styles.pressed : null]}
      >
        <Text style={styles.title}>{task.title}</Text>
        {/* The line of the minutes, when the title had to be cut from it. */}
        {item.quote && item.quote !== task.title ? (
          <Text style={styles.meta} numberOfLines={3}>
            {`“${item.quote}”`}
          </Text>
        ) : null}
        {lastYear ? <Text style={styles.meta}>{lastYear}</Text> : null}
        <Text style={styles.meta}>{meta}</Text>
      </Pressable>
      {onAlreadyDoing ? (
        <RowActions
          name={task.title}
          busy={busy}
          disabled={disabled}
          report={report}
          primary={accept}
          secondary={{
            label: LAST_YEAR_COPY.alreadyDoing,
            doing: "already",
            onPress: onAlreadyDoing,
          }}
          quiet={dismiss}
          styles={styles}
        />
      ) : (
        <RowActions
          name={task.title}
          busy={busy}
          disabled={disabled}
          report={report}
          primary={accept}
          secondary={dismiss}
          styles={styles}
        />
      )}
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
      <View accessible accessibilityLabel={`${event.name}. ${line}`} style={styles.cardText}>
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
            ? { label: LAST_YEAR_COPY.addEvent, doing: "accept", onPress: onAdd }
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

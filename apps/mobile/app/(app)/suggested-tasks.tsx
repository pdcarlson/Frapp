import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { codeOf } from "@repo/api-sdk";
import {
  useAcceptAiSuggestion,
  useAiSuggestions,
  useDismissAiSuggestion,
  useMeetings,
  useMemberDisplayNames,
  type AiSuggestion,
  type TaskSuggestionEdits,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_REPORT_COPY,
  AI_SUGGESTION_COPY,
  aiSuggestionRefusalLine,
  meetingDueLabel,
} from "@repo/validation";
import {
  useAiReport,
  type AiReportTarget,
} from "@/components/ai/report-ai-sheet";
import type { BackTarget } from "@/components/back-row";
import { InlineNote } from "@/components/inline-note";
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
import type { ValidatedNewTask } from "@/lib/tasks/create-task";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Suggested tasks on the phone (#4313, `spec/behavior/meetings.md`
 * § Suggested tasks): the action items of posted minutes, each waiting for an
 * officer to accept it into a task, change it first, or dismiss it. Nothing
 * is a task until they do. It is where the "tasks were suggested" push
 * lands, and where the Tasks tab's one row and a meeting's minutes lead. Web
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
 */
const BACK_TO_TASKS: BackTarget = { label: "Tasks", href: "/tasks" };

type SuggestedTask = NonNullable<AiSuggestion["task"]>;
type Waiting = AiSuggestion & { task: SuggestedTask };

function isWaitingTask(item: AiSuggestion): item is Waiting {
  return item.kind === "task" && item.task !== null;
}

/** Only what the officer changed in the form, as the accept route takes it. */
export function suggestionEdits(
  task: SuggestedTask,
  form: ValidatedNewTask,
): TaskSuggestionEdits | undefined {
  const edits: TaskSuggestionEdits = {};
  if (form.title !== task.title) edits.title = form.title;
  if (form.assignee_id !== task.assignee_id) {
    edits.assignee_id = form.assignee_id;
  }
  const dueAt = form.due_at ?? null;
  if (form.due_date !== task.due_date || dueAt !== task.due_at) {
    edits.due_date = form.due_date;
    edits.due_at = dueAt;
  }
  const steps = form.subtasks ?? [];
  if (
    steps.length !== task.subtasks.length ||
    steps.some((step, index) => step !== task.subtasks[index])
  ) {
    edits.subtasks = steps;
  }
  return Object.keys(edits).length > 0 ? edits : undefined;
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
  const items = useMemo(
    () => (suggestionsQuery.data?.items ?? []).filter(isWaitingTask),
    [suggestionsQuery.data],
  );
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

  const [busy, setBusy] = useState<{ id: string; doing: "accept" | "dismiss" } | null>(
    null,
  );
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

  function fail(item: Waiting, error: unknown) {
    const refusal = aiSuggestionRefusalLine(codeOf(error));
    if (refusal) {
      setGone(`“${item.task.title}”: ${refusal}`);
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

  async function dismissRow(item: Waiting) {
    setGone(null);
    setBusy({ id: item.id, doing: "dismiss" });
    try {
      await dismiss.mutateAsync(item.id);
    } catch (error) {
      fail(item, error);
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
      report={reportFor(item, reporting)}
      styles={styles}
    />
  );

  return (
    <>
      <ScreenShell
        back={BACK_TO_TASKS}
        title={AI_SUGGESTION_COPY.heading}
        refresh={refresh}
      >
        {gone ? <InlineNote tone="warning">{gone}</InlineNote> : null}
        {suggestionsQuery.isPending ? (
          <SuggestionsSkeleton />
        ) : suggestionsQuery.isError && !suggestionsQuery.data ? (
          <ErrorState
            title={AI_SUGGESTION_COPY.loadFailedTitle}
            body={AI_SUGGESTION_COPY.loadFailedBody}
            onRetry={() => void suggestionsQuery.refetch()}
            isRetrying={suggestionsQuery.isFetching}
          />
        ) : items.length === 0 ? (
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
      </ScreenShell>
      {formFor && seed ? (
        <NewTaskSheet
          key={formFor.id}
          ref={formRef}
          suggestion={seed}
          onClosed={() => setFormFor(null)}
        />
      ) : null}
      {reporting.reportSheet}
    </>
  );
}

/** A suggestion's "Report this", for a member who may report (#4315). */
function reportFor(item: Waiting, reporting: ReturnType<typeof useAiReport>) {
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

function SuggestionRow({
  item,
  who,
  busy,
  disabled,
  problem,
  onOpen,
  onAccept,
  onDismiss,
  report,
  styles,
}: {
  item: Waiting;
  who: string | null;
  busy: "accept" | "dismiss" | null;
  disabled: boolean;
  problem: string | null;
  onOpen: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  report: { reported: boolean; onPress: () => void } | null;
  styles: Styles;
}) {
  const { accent, accentOnPrimary } = useChapterBranding();
  const { task } = item;
  const meta = [
    who ?? AI_SUGGESTION_COPY.who,
    task.due_date ? `Due ${meetingDueLabel(task.due_date)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${task.title}. ${meta}`}
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
        <Text style={styles.meta}>{meta}</Text>
      </Pressable>
      <View style={styles.actions}>
        {/* Quiet and to the left, away from the two decisions. The words
            change in place, so the row keeps its height. */}
        {report ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              report.reported
                ? AI_REPORT_COPY.reported
                : `${AI_REPORT_COPY.action}: ${task.title}`
            }
            accessibilityState={report.reported ? { disabled: true } : undefined}
            disabled={report.reported}
            hitSlop={4}
            onPress={report.onPress}
            style={({ pressed }) => [
              styles.report,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.meta}>
              {report.reported
                ? AI_REPORT_COPY.reported
                : AI_REPORT_COPY.action}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${AI_SUGGESTION_COPY.dismiss}: ${task.title}`}
          accessibilityState={{ disabled, busy: busy === "dismiss" }}
          disabled={disabled}
          // 36pt drawn against the 44pt minimum.
          hitSlop={4}
          onPress={onDismiss}
          style={({ pressed }) => [
            styles.button,
            styles.dismiss,
            pressed ? styles.pressed : null,
            disabled && busy !== "dismiss" ? styles.dimmed : null,
          ]}
        >
          <Text style={styles.dismissText}>{AI_SUGGESTION_COPY.dismiss}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${AI_SUGGESTION_COPY.accept}: ${task.title}`}
          accessibilityState={{ disabled, busy: busy === "accept" }}
          disabled={disabled}
          hitSlop={4}
          onPress={onAccept}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: accent },
            pressed ? styles.pressed : null,
            disabled && busy !== "accept" ? styles.dimmed : null,
          ]}
        >
          {/* The same words while it saves, so the button keeps its width. */}
          <Text style={[styles.acceptText, { color: accentOnPrimary }]}>
            {AI_SUGGESTION_COPY.accept}
          </Text>
        </Pressable>
      </View>
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
  return StyleSheet.create({
    group: {
      gap: tokens.spacing.sm,
    },
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
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
      backgroundColor: tokens.color.surface.surface1,
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

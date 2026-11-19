import { describeLoadFailure, errorCopy } from "@repo/hooks/error-copy";
import { useCallback, useMemo, useState } from "react";
import { AccessibilityInfo, Alert, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { formatPoints } from "@repo/formatting";
import {
  useAssignOpenTask,
  useClaimOpenTask,
  useDeleteOpenTask,
  useOpenTasks,
  usePermissionList,
  useViewerUserId,
  type OpenTask,
} from "@repo/hooks";
import {
  TASK_AUDIENCE_COPY,
  TASK_PROOF_KIND_HINTS,
  canAll,
} from "@repo/validation";
import { PLUS_MENU_PERMISSIONS } from "@repo/chat-core/plus-menu";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_TASKS } from "@/components/back-row";
import { HairlineChip } from "@/components/status-chip";
import { InlineNote } from "@/components/inline-note";
import { ErrorState } from "@/components/state-block";
import {
  CheckGlyph,
  PersonGlyph,
  TrashGlyph,
} from "@/components/control-glyphs";
import {
  TaskActionBar,
  TaskActionBarSpacer,
  TaskBarIcon,
  TaskBarPill,
} from "@/components/tasks/task-action-bar";
import { OpenTaskAssignPicker } from "@/components/tasks/open-task-picker";
import {
  createTaskFactStyles,
  TaskDetailSkeleton,
  TaskFact,
  TaskFacts,
  TaskMinutesFact,
} from "@/components/tasks/task-facts";
import { useChapterBranding } from "@/lib/chapter-branding";
import { goBackTo } from "@/lib/href";
import { successHaptic } from "@/lib/haptics";
import { formatDueDate } from "@/lib/tasks/format";
import { taskCreatedLine } from "@/lib/tasks/create-task";
import { useMemberLabel } from "@/lib/tasks/use-member-label";
import {
  ASSIGNED_PARAM,
  claimLost,
  claimedLine,
  claimedTaskId,
  openTaskWho,
} from "@/lib/tasks/open-tasks";
import { typeRole, useFrappTheme } from "@/lib/theme";

const POSTING_FAILED = "That didn't go through. Try again.";

/**
 * A task up for grabs as its own pushed screen (#5570), where its sheet rose
 * until then (`OpenTaskSheet`, deleted): Paul's rule from #5492, no pop-up
 * sheet for a task, now holds for a posting too. `task-details.tsx` draws it
 * for `/task-details?posting=<id>`, so both kinds of task open on the one
 * route. Laid out as the task's screen is: the title, a chip saying it is up
 * for grabs, Due, Points and Steps as Linear's issue header lists its facts,
 * who may claim it on its own line, the description and what Mark done will
 * ask for. Its controls float at the bottom in the task screen's glass bar,
 * as Things 3 keeps a to-do's: Claim, the accent pill, for a member who may
 * claim it; Assign to someone and Delete, rounds, for an officer who manages
 * tasks (`tasks:manage` under `members:view`, the quick actions' grant).
 *
 * The posting is read off the board's `GET /v1/open-tasks`, which the board
 * that pushed this screen has already read. A claim takes the member to the
 * task it made (the screen is replaced, so back is the board), where Give it
 * back sits in More. A hand-over goes back to the board, which says who has
 * it in its line (`/tasks?assigned=<userId>`); a delete goes back to it too.
 * A posting someone else took or an officer took down while it was open
 * says so, rather than a load failure.
 */
export function OpenTaskScreen({ postingId }: { postingId: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const factStyles = createTaskFactStyles(tokens);
  const { accent } = useChapterBranding();
  const router = useRouter();

  const openTasksQuery = useOpenTasks();
  const found = useMemo(
    () =>
      (openTasksQuery.data ?? []).find(
        (item) => item.id === postingId && item.status === "open",
      ) ?? null,
    [openTasksQuery.data, postingId],
  );
  // The last read of it, held while a move is on its way and as the screen
  // leaves: a claim takes the posting off the list the moment it is tapped
  // (`useClaimOpenTask` is optimistic), which would otherwise flash "isn't
  // on Up for grabs any more" under the member's own claim.
  const [held, setHeld] = useState<OpenTask | null>(null);
  if (found !== null && found !== held) setHeld(found);
  const [leaving, setLeaving] = useState(false);
  const permissions = usePermissionList();
  const canManage = canAll(PLUS_MENU_PERMISSIONS.task, permissions);

  const nameOf = useMemberLabel();
  const viewerUserId = useViewerUserId();

  const claimOpen = useClaimOpenTask();
  const assignOpen = useAssignOpenTask();
  const deleteOpen = useDeleteOpenTask();
  const busy =
    claimOpen.isPending || assignOpen.isPending || deleteOpen.isPending;
  const posting = found ?? (busy || leaving ? held : null);
  const [problem, setProblem] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const failed = useCallback((error: unknown) => {
    setProblem(
      claimLost(error)
        ? TASK_AUDIENCE_COPY.alreadyClaimed
        : errorCopy(error, POSTING_FAILED, { serverWritesForMembers: true }),
    );
  }, []);

  const claim = (item: OpenTask) => {
    setProblem(null);
    claimOpen.mutate(item.id, {
      onSuccess: (data) => {
        setLeaving(true);
        successHaptic();
        AccessibilityInfo.announceForAccessibility(
          claimedLine(item, new Date()),
        );
        const taskId = claimedTaskId(data);
        if (taskId) {
          router.replace({ pathname: "/task-details", params: { id: taskId } });
        } else {
          goBackTo(router, BACK_TO_TASKS.href);
        }
      },
      onError: failed,
    });
  };

  const assign = (item: OpenTask, userId: string) => {
    setProblem(null);
    assignOpen.mutate(
      { id: item.id, assigneeId: userId },
      {
        onSuccess: () => {
          setLeaving(true);
          // Said here, as Give it back says its line before it goes: the
          // board's line has no live region to speak it on arrival.
          AccessibilityInfo.announceForAccessibility(
            taskCreatedLine(nameOf(userId), userId === viewerUserId),
          );
          goBackTo(router, {
            pathname: "/tasks",
            params: { [ASSIGNED_PARAM]: userId },
          });
        },
        onError: failed,
      },
    );
  };

  const confirmDelete = (item: OpenTask) =>
    Alert.alert(
      `Delete “${item.title}”?`,
      `It comes off ${TASK_AUDIENCE_COPY.upForGrabs} for everyone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setProblem(null);
            deleteOpen.mutate(item.id, {
              onSuccess: () => {
                setLeaving(true);
                goBackTo(router, BACK_TO_TASKS.href);
              },
              onError: failed,
            });
          },
        },
      ],
    );

  if (!posting) {
    if (openTasksQuery.data === undefined && !openTasksQuery.isError) {
      return (
        <ScreenShell back={BACK_TO_TASKS} title="Task">
          <TaskDetailSkeleton />
        </ScreenShell>
      );
    }
    if (openTasksQuery.data === undefined) {
      return (
        <ScreenShell back={BACK_TO_TASKS} title="Task">
          <ErrorState
            title="Couldn't load this task"
            body={describeLoadFailure(openTasksQuery.error)}
            onRetry={() => void openTasksQuery.refetch()}
            isRetrying={openTasksQuery.isFetching}
          />
        </ScreenShell>
      );
    }
    return (
      <ScreenShell back={BACK_TO_TASKS} title="Task">
        <InlineNote>
          {`This task isn't on ${TASK_AUDIENCE_COPY.upForGrabs} any more.`}
        </InlineNote>
      </ScreenShell>
    );
  }

  const due = formatDueDate(posting.due_at ?? posting.due_date);
  const steps = posting.subtask_titles.length;
  const onClaim = posting.viewer_can_claim ? () => claim(posting) : undefined;

  return (
    <View style={styles.frame}>
      <ScreenShell back={BACK_TO_TASKS} title={posting.title}>
        <View style={styles.chipRow}>
          <HairlineChip label={TASK_AUDIENCE_COPY.upForGrabs} />
        </View>

        {due || posting.point_reward || steps > 0 ? (
          <TaskFacts>
            {due ? (
              <TaskFact label="Due" value={due.replace(/^Due /, "")} />
            ) : null}
            {posting.point_reward ? (
              <TaskFact
                label="Points"
                value={formatPoints(posting.point_reward)}
              />
            ) : null}
            {steps > 0 ? (
              <TaskFact
                label="Steps"
                value={`${steps} ${steps === 1 ? "step" : "steps"}`}
              />
            ) : null}
          </TaskFacts>
        ) : null}

        <View style={styles.whoFact}>
          <Text style={factStyles.factLabel}>Who can claim</Text>
          <Text style={factStyles.factValue}>
            {openTaskWho(posting, nameOf)}
          </Text>
        </View>

        {problem ? (
          <Text style={styles.problem} accessibilityLiveRegion="polite">
            {problem}
          </Text>
        ) : null}

        {posting.description ? (
          <Text style={styles.description} selectable>
            {posting.description}
          </Text>
        ) : null}

        {posting.meeting_id ? (
          <TaskMinutesFact meetingId={posting.meeting_id} />
        ) : null}

        {posting.proof_kind !== "none" ? (
          <Text style={styles.note}>
            {TASK_PROOF_KIND_HINTS[posting.proof_kind]}
          </Text>
        ) : null}

        {onClaim || canManage ? <TaskActionBarSpacer /> : null}
      </ScreenShell>

      {onClaim || canManage ? (
        <TaskActionBar>
          {onClaim ? (
            <TaskBarPill
              label={TASK_AUDIENCE_COPY.claim}
              glyph={(ink) => <CheckGlyph color={ink} />}
              fill={accent}
              ink={tokens.color.gold.onHouse}
              disabled={busy && !claimOpen.isPending}
              busy={claimOpen.isPending}
              onPress={onClaim}
            />
          ) : null}
          {canManage ? (
            <TaskBarIcon
              label={TASK_AUDIENCE_COPY.assignToSomeone}
              hint="Pick the member who does it."
              disabled={busy}
              onPress={() => setAssigning(true)}
            >
              <PersonGlyph color={tokens.color.text.foreground} />
            </TaskBarIcon>
          ) : null}
          {canManage ? (
            <TaskBarIcon
              label="Delete"
              hint={`Takes it off ${TASK_AUDIENCE_COPY.upForGrabs} for everyone.`}
              disabled={busy}
              onPress={() => confirmDelete(posting)}
            >
              <TrashGlyph color={tokens.color.semantic.destructiveText} />
            </TaskBarIcon>
          ) : null}
        </TaskActionBar>
      ) : null}

      {assigning ? (
        <OpenTaskAssignPicker
          onPick={(userId) => assign(posting, userId)}
          onClosed={() => setAssigning(false)}
        />
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    frame: {
      flex: 1,
    },
    chipRow: {
      flexDirection: "row",
    },
    whoFact: {
      gap: tokens.spacing.xs,
    },
    description: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
  });
}

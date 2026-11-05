import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import type { TaskPayload } from "@repo/chat-core/cards";
import { serverMessageOf } from "@repo/api-sdk";
import {
  canReadCardTask,
  readLiveTask,
  taskCardControls,
  taskCardStatusLabel,
  useConfirmTask,
  useCurrentChapter,
  useNowDate,
  usePermissionList,
  useRejectTask,
  useTask,
  useUpdateTaskStatus,
  type LiveTask,
} from "@repo/hooks";
import { can, isModuleEnabled } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { TasksGlyph } from "@/components/tab-glyphs";
import { StatusChip } from "@/components/status-chip";
import { useConnection } from "@/lib/connection/use-connection";
import { formatDueDate, formatDueSubtitle } from "@/lib/tasks/format";
import { taskStatusGateRefusal } from "@/lib/tasks/status-refusal";
import { useFrappTheme } from "@/lib/theme";
import {
  CardActions,
  CardButton,
  CardEyebrow,
  CardMeta,
  CardNote,
  CardTitle,
  ChatCardShell,
  PointsChip,
  type ChatCardFrameProps,
} from "./chat-card";

/**
 * The chat task card on mobile (#3185), web's
 * `apps/web/components/chat/renderers/task-card.tsx` on the phone.
 *
 * The message is an immutable creation-time snapshot (who assigned whom, the
 * title, the due date, the reward), read by `readTaskPayload`. The status is
 * the *live* task, read back through `useTask`, so the card follows the task
 * through its life without the message row ever changing.
 *
 * **The rules are web's.** Who may read the task, which status badge to draw
 * and which controls to offer are `canReadCardTask`, `taskCardStatusLabel` and
 * `taskCardControls` in `@repo/hooks`, the copy both cards apply
 * (`spec/behavior/tasks.md` § Chat Integration). In short: no control until
 * the live task is read (#2065), the assignee walks Start then Mark complete
 * off the stored status (#1051), and a `tasks:manage` holder confirms or
 * rejects a completion, never their own (#1056). The writes are the shared
 * hooks, which update the cache optimistically and roll back on refusal.
 *
 * Mobile has no toast, so a refusal is a line on the card. A gate refusal is
 * in the board's own words (`taskStatusGateRefusal`) and withdraws the
 * controls, as the board's does (`writing.md`): pressing again would only
 * fetch the same refusal. Like the board's, it lasts until the member comes
 * back to the thread or to the app. Any other refusal relays the server's
 * message and leaves them to retry. None of these writes has an outbox, so
 * they are disabled while a write would be lost
 * (`useConnection().writeBlockedReason`).
 */
export function TaskCard({
  payload,
  ...frame
}: ChatCardFrameProps & { payload: TaskPayload }) {
  const { tokens } = useFrappTheme();
  const now = useNowDate();

  // `!!viewerId`: a missing viewer must never match a missing assignee id.
  const isAssignee =
    !!frame.viewerId && frame.viewerId === payload.assignee_user_id;
  const canManage = can("tasks:manage", usePermissionList());
  const liveQuery = useTask(
    canReadCardTask({ isAssignee, canManage }) ? payload.task_id : "",
  );
  const live = readLiveTask(liveQuery.data);

  // The member view the module gate reads, as the poll card's does. A card
  // whose actions the server would refuse offers none; a timeline of task
  // cards repeating "Tasks are turned off" would be noise.
  const chapterQuery = useCurrentChapter();
  const tasksOff =
    chapterQuery.data !== undefined &&
    !isModuleEnabled(chapterQuery.data?.enabled_modules, "tasks");
  const controls = tasksOff
    ? []
    : taskCardControls({ live, isAssignee, canManage });

  const { writeBlockedReason } = useConnection();
  const updateStatus = useUpdateTaskStatus();
  const confirmTask = useConfirmTask();
  const rejectTask = useRejectTask();
  const [refusal, setRefusal] = useState<{
    text: string;
    /** A gate's: the controls stay withdrawn rather than invite a retry. */
    gate: boolean;
  } | null>(null);
  // Cleared when the member comes back, as the board's is: an officer may have
  // sorted the gate out since, and nothing on a withdrawn card can be pressed
  // to find out. Back to the thread is a navigation focus; back to the app
  // with the thread still open is an AppState change, which focus never sees.
  // The listener is held only while there is a refusal to clear, so a thread
  // of task cards doesn't register one per card.
  useFocusEffect(
    useCallback(() => {
      setRefusal(null);
      return undefined;
    }, []),
  );
  const hasRefusal = refusal !== null;
  useEffect(() => {
    if (!hasRefusal) return undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setRefusal(null);
    });
    return () => subscription.remove();
  }, [hasRefusal]);
  const pending =
    updateStatus.isPending || confirmTask.isPending || rejectTask.isPending;
  // The hooks' `isPending` reaches React a tick after the press, so two taps
  // in one frame would both send; the ref is set before the first await.
  const inFlight = useRef(false);

  /** Runs one write; a refusal lands on the card, the hook has rolled back. */
  const act = async (write: () => Promise<unknown>, fallback: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefusal(null);
    try {
      await write();
    } catch (error) {
      const gate = taskStatusGateRefusal(error);
      setRefusal(
        gate
          ? { text: gate, gate: true }
          : { text: serverMessageOf(error) ?? fallback, gate: false },
      );
    } finally {
      inFlight.current = false;
    }
  };

  const blockedReason =
    writeBlockedReason ?? (refusal?.gate ? refusal.text : null);
  const disabled = !frame.isConfirmed || pending || blockedReason !== null;
  const hint = blockedReason ?? undefined;

  return (
    <ChatCardShell
      {...frame}
      header={
        <>
          <CardEyebrow
            label="Task"
            glyph={TasksGlyph}
            trailing={
              live ? (
                <StatusChip
                  label={taskCardStatusLabel(live)}
                  hue={statusHue(live, tokens)}
                />
              ) : null
            }
          />
          <CardTitle>{payload.title}</CardTitle>
          <CardMeta
            items={[`${payload.assigner_name} → ${payload.assignee_name}`]}
          />
          <CardMeta
            items={[
              dueLine(payload.due_date, live, now),
              payload.point_reward ? (
                <PointsChip points={payload.point_reward} />
              ) : null,
            ]}
          />
        </>
      }
    >
      {controls.length > 0 ? (
        <CardActions>
          {controls.includes("start") ? (
            <CardButton
              label="Start"
              disabled={disabled}
              accessibilityHint={hint}
              onPress={() =>
                void act(
                  () =>
                    updateStatus.mutateAsync({
                      id: payload.task_id,
                      body: { status: "IN_PROGRESS" },
                    }),
                  "Couldn't start the task.",
                )
              }
            />
          ) : null}
          {controls.includes("complete") ? (
            <CardButton
              label="Mark complete"
              disabled={disabled}
              accessibilityHint={hint}
              onPress={() =>
                void act(
                  () =>
                    updateStatus.mutateAsync({
                      id: payload.task_id,
                      body: { status: "COMPLETED" },
                    }),
                  "Couldn't mark the task complete.",
                )
              }
            />
          ) : null}
          {controls.includes("confirm") ? (
            <CardButton
              label="Confirm"
              variant="primary"
              disabled={disabled}
              accessibilityHint={hint}
              icon={(color) => <CheckGlyph color={color} />}
              onPress={() =>
                void act(
                  () => confirmTask.mutateAsync(payload.task_id),
                  "Couldn't confirm the task.",
                )
              }
            />
          ) : null}
          {controls.includes("confirmed") ? (
            // An indicator, not an action: the completion was confirmed.
            <CardButton
              label="Confirmed"
              disabled
              onPress={() => undefined}
              icon={(color) => <CheckGlyph color={color} />}
            />
          ) : null}
          {controls.includes("reject") ? (
            <CardButton
              label="Reject"
              disabled={disabled}
              accessibilityHint={hint}
              onPress={() =>
                void act(
                  () => rejectTask.mutateAsync({ id: payload.task_id }),
                  "Couldn't reject the task.",
                )
              }
            />
          ) : null}
        </CardActions>
      ) : null}
      {refusal ? (
        <CardNote text={refusal.text} tone={refusal.gate ? "muted" : "error"} />
      ) : null}
    </ChatCardShell>
  );
}

/**
 * The badge's hue: a status color, never the chapter accent (§5). Overdue is
 * the warning a member has to act on, so it is the one in red.
 */
function statusHue(live: LiveTask, tokens: SignetTokens): string {
  switch (live.status) {
    case "OVERDUE":
      return tokens.color.semantic.destructive;
    case "COMPLETED":
      return live.points_awarded
        ? tokens.color.semantic.success
        : tokens.color.semantic.warning;
    case "IN_PROGRESS":
      return tokens.color.semantic.info;
    case "TODO":
      return tokens.color.text.mutedForeground;
  }
}

/**
 * The due date. Relative ("Due tomorrow", "Overdue by 2 days") only while the
 * live task says it is still open, since that is when the countdown is true.
 * A finished task, or one this viewer can't read, gets the plain date: an
 * "Overdue by 3 days" on a task that was done on time would be wrong.
 */
function dueLine(
  dueDate: string,
  live: LiveTask | null,
  now: Date,
): string | null {
  return live && live.status !== "COMPLETED"
    ? formatDueSubtitle(dueDate, now)
    : formatDueDate(dueDate);
}

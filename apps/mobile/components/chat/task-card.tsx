import { useState } from "react";
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
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";
import { formatDueSubtitle, parseTaskDate } from "@/lib/tasks/format";
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
 * Mobile has no toast, so a refusal is a line on the card, gate refusals in
 * the board's own words (`SUBSCRIPTION_REFUSAL_COPY`/`MODULE_REFUSAL_COPY`).
 * None of these writes has an outbox, so they are disabled while a write
 * would be lost (`useConnection().writeBlockedReason`).
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
  const [refusal, setRefusal] = useState<string | null>(null);
  const pending =
    updateStatus.isPending || confirmTask.isPending || rejectTask.isPending;

  /** Runs one write; a refusal lands on the card, the hook has rolled back. */
  const act = async (write: () => Promise<unknown>, fallback: string) => {
    setRefusal(null);
    try {
      await write();
    } catch (error) {
      if (subscriptionRefusalOf(error)) {
        setRefusal(SUBSCRIPTION_REFUSAL_COPY.taskStatus);
      } else if (moduleRefusalOf(error)) {
        setRefusal(MODULE_REFUSAL_COPY.taskStatus);
      } else {
        setRefusal(serverMessageOf(error) ?? fallback);
      }
    }
  };

  const disabled = !frame.isConfirmed || pending || writeBlockedReason !== null;
  const hint = writeBlockedReason ?? undefined;

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
            items={[
              `${payload.assigner_name} → ${payload.assignee_name}`,
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
      {refusal ? <CardNote text={refusal} tone="error" /> : null}
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
  if (live && live.status !== "COMPLETED") {
    return formatDueSubtitle(dueDate, now);
  }
  const due = parseTaskDate(dueDate);
  if (!due) return null;
  return `Due ${due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

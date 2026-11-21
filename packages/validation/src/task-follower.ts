/**
 * A group that follows a task (#5473; Shawn, 2026-11-18: "the executive board
 * or cabinet assigns a specific person, and then everyone in the executive
 * board has access to it"). `spec/behavior/tasks.md` § Following a task.
 *
 * A task's `followed_by` names a tier, a role or a chapter group in the
 * spelling channel access lists use (`tier:<id>`, `role:<id>`,
 * `group:<id>`, {@link channelAccessEntry}). Its active members, read live,
 * can read the task and its progress (not its proof) and hear when it is
 * finished or overdue. Confirm and Send back stay with officers.
 */
import {
  channelAccessEntry,
  parseChannelAccessEntry,
  type ChannelAccessEntryKind,
} from "./channel-access-lists";

export type TaskFollowerKind = ChannelAccessEntryKind;

/** The stored entry for a tier, role or group following a task. */
export function taskFollowerEntry(kind: TaskFollowerKind, id: string): string {
  return channelAccessEntry(kind, id);
}

/** A stored entry read back, or null when it isn't one. */
export function parseTaskFollower(
  entry: string | null | undefined,
): { kind: TaskFollowerKind; id: string } | null {
  return entry ? parseChannelAccessEntry(entry) : null;
}

/** The words every surface uses for a task's following group. */
export const TASK_FOLLOWER_COPY = {
  /** The field in a task form's More options. */
  field: "From",
  /** The field's default: the task comes from its creator alone. */
  justYou: "Just you",
  /** The hint under the field once a group is picked. */
  hint: (name: string) =>
    `Everyone in ${name} can see this task and how it's going. Officers still confirm it.`,
  /** A chip on a task's tile, card or screen: "From Exec board". */
  chip: (name: string | null | undefined) =>
    `From ${name?.trim() || TASK_FOLLOWER_COPY.deleted}`,
  /** The review's header: "Submitted to Exec board". */
  submittedTo: (name: string | null | undefined) =>
    `Submitted to ${name?.trim() || TASK_FOLLOWER_COPY.deleted}`,
  /** A following tier, role or group since deleted. */
  deleted: "a deleted group",
  /** Under From once its tier, role or group is deleted: nobody follows. */
  deletedHint: "That group was deleted, so nobody follows this task now.",
  /** A follower without `tasks:manage` sees the task read-only. */
  readOnly: "You're following this task. An officer confirms it.",
  /** The switch's word for every task the reader can see. */
  allTasks: "All tasks",
  /** Refused: the creator names a group they aren't in. */
  notIn: "Pick a tier, role or group you're in",
  /** Why a repeating task can't name one yet. */
  noRepeat: "A repeating task can't be from a group yet.",
} as const;

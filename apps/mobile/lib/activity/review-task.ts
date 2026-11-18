import type { ActivityTask } from "@repo/hooks";
import { isTaskStatus } from "@repo/hooks";
import { isRecord } from "@/lib/more/narrow";
import { toTaskRow } from "@/lib/tasks/board";

/**
 * A task read by id (`GET /v1/tasks/:id`) in the shape an Activity row
 * carries, for a review push the Activity read lists no row for (#5492: a
 * copy of a task for everyone, whose row names only the copy it opens). The
 * names are the roster's (`nameOf`), since the task read carries none; one
 * the roster doesn't hold (a member who left) is empty, as the read's is.
 * `null` for a read that isn't a task.
 */
export function reviewTaskOf(
  data: unknown,
  nameOf: (userId: string) => string | null | undefined,
): ActivityTask | null {
  if (!isRecord(data)) return null;
  const row = toTaskRow(data);
  if (!row || !row.assigneeId || !row.createdBy) return null;
  const stored = isTaskStatus(row.storedStatus) ? row.storedStatus : "TODO";
  return {
    id: row.id,
    title: row.title,
    due_date: row.dueDate ?? "",
    due_at: row.dueAt,
    status: isTaskStatus(row.displayStatus) ? row.displayStatus : stored,
    stored_status: stored,
    assignee_id: row.assigneeId,
    assignee_name: nameOf(row.assigneeId) ?? "",
    created_by: row.createdBy,
    created_by_name: nameOf(row.createdBy) ?? "",
    point_reward: row.pointReward,
    completed_at: row.completedAt,
    confirmed_at: row.confirmedAt,
    sent_back_at: row.sentBackAt,
    proof_kind: row.proofKind,
    group: null,
    created_at: row.createdAt ?? "",
    unread: false,
    snoozed_until: null,
  };
}

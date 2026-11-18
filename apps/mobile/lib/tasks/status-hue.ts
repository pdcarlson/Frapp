import { isSentBack, type TaskStatus } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";

/**
 * A task status chip's hue: a status color, never the chapter accent
 * (`components.md` §5). Overdue is the warning a member has to act on, so it
 * is the one in red. The task card in chat and the task screen draw it, and
 * web's board reads the same table (`taskStatusKind` in
 * `apps/web/components/tasks/task-status.ts`), so a task reads alike on both
 * apps (#4133).
 */
export function taskStatusHue(
  task: {
    status: TaskStatus;
    stored_status?: TaskStatus;
    sent_back_at?: string | null;
    points_awarded: boolean;
  },
  tokens: SignetTokens,
): string {
  // Needs changes (#4635): back with its assignee, with something to fix.
  if (isSentBack(task)) return tokens.color.semantic.warning;
  switch (task.status) {
    case "OVERDUE":
      return tokens.color.semantic.destructive;
    case "COMPLETED":
      return task.points_awarded
        ? tokens.color.semantic.success
        : tokens.color.semantic.warning;
    case "IN_PROGRESS":
      return tokens.color.semantic.info;
    case "TODO":
      return tokens.color.text.mutedForeground;
  }
}

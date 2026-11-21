import type { TaskStatus } from "@repo/hooks";
import type { BadgeKind } from "@/components/ui/badge";

/**
 * A task's live status → the §5 badge kind that states it, the colours the
 * phone's task card draws (`statusHue` in
 * `apps/mobile/components/chat/task-card.tsx`), so a task reads the same on
 * both apps (#4133). Never the chapter accent: until #4133 web painted In
 * progress and Completed in `default`, the Accent kind, which `components.md`
 * §5 forbids for a status.
 *
 * - To do: Hairline, quiet until someone starts it.
 * - In progress: info blue.
 * - Completed: success green once the points are awarded, warning amber while
 *   it waits on an officer's confirm, since nothing has been awarded yet.
 * - Overdue: danger, the one a member has to act on.
 *
 * An unknown status falls back to Hairline, never the accent.
 */
export function taskStatusKind(task: {
  status: TaskStatus;
  points_awarded?: boolean | null;
}): BadgeKind {
  switch (task.status) {
    case "TODO":
      return "outline";
    case "IN_PROGRESS":
      return "info";
    case "COMPLETED":
      return task.points_awarded ? "success" : "warning";
    case "OVERDUE":
      return "destructive";
    default:
      return "outline";
  }
}

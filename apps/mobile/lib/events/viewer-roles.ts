import { useMemo } from "react";
import { useActiveChapterId, useListChapters } from "@repo/hooks";
import {
  eventAttendanceFor,
  type EventAttendanceFields,
} from "@repo/validation";

/**
 * The viewer's role ids in the active chapter, from the memberships list the
 * app already holds. Empty while it loads.
 */
function useViewerRoleIds(): readonly string[] {
  const chapterId = useActiveChapterId();
  const chapters = useListChapters();
  return useMemo(
    () =>
      chapters.data?.find((membership) => membership.chapter_id === chapterId)
        ?.role_ids ?? [],
    [chapters.data, chapterId],
  );
}

/**
 * Whether an event is required of the viewer, by default or by a role of
 * theirs (`spec/behavior/events.md` § Attendance by role): what a list row's
 * Mandatory chip says. An event required only of officers carries the chip
 * for an officer and not for anyone else.
 */
export function useRequiredOfViewer(): (
  event: EventAttendanceFields,
) => boolean {
  const roleIds = useViewerRoleIds();
  return (event) => eventAttendanceFor(event, roleIds).status === "required";
}

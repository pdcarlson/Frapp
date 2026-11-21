import { useCallback } from "react";
import { useMemberDisplayNames } from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";

/**
 * A member's name as the task screens say it (`memberLabel` over the
 * chapter roster), one lookup for the board, a task's screen and a
 * posting's, so the three name one member the same way (#5570).
 */
export function useMemberLabel(): (userId: string) => string {
  const { byId } = useMemberDisplayNames();
  return useCallback(
    (userId: string) => memberLabel(byId[userId], userId),
    [byId],
  );
}

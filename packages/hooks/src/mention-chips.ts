import { createContext, useContext, useMemo } from "react";
import { mentionChipFilter, type MentionChipTargets } from "@repo/validation";

/**
 * Who a chat timeline's messages could have addressed: the chapter roster and
 * its role names (`useChapterRoster`, `useMentionRoles`). The thread screen
 * provides it once so a row needs no query of its own; a body rendered outside
 * one (an announcement card, a preview) reads `null` and chips by `mentions`
 * alone.
 *
 * A subpath of its own (`@repo/hooks/mention-chips`) holding no query, so a
 * spec that mocks `@repo/hooks` whole still renders a message body.
 */
export const MentionChipTargetsContext =
  createContext<MentionChipTargets | null>(null);

/**
 * Which of a message's `@`-tokens to paint as a mention chip, from the
 * message's resolved `mentions` (`mentionChipFilter`). Stable while neither
 * changes, so a memoized parse keyed on it re-runs only when it must.
 */
export function useMentionChips(
  mentions: readonly string[] | null | undefined,
): (token: string) => boolean {
  const targets = useContext(MentionChipTargetsContext);
  const key = (mentions ?? []).join(",");
  return useMemo(
    () => mentionChipFilter(key ? key.split(",") : [], targets),
    [key, targets],
  );
}

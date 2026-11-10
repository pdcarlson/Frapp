import { createContext, useContext, useMemo } from "react";
import {
  mentionChipFilter,
  spacedMentionNames,
  type MentionChipTargets,
} from "@repo/validation";

/**
 * Who a chat timeline's messages could have addressed: the chapter roster and
 * its role names (`useChapterRoster`, `useMentionRoles`). The thread screen
 * provides it once so a row needs no query of its own; a body rendered outside
 * one reads `null` and chips by the message's `mentions` alone.
 *
 * A subpath of its own (`@repo/hooks/mention-chips`) holding no query, so a
 * spec that mocks `@repo/hooks` whole still renders a message body.
 */
export const MentionChipTargetsContext =
  createContext<MentionChipTargets | null>(null);

/**
 * A chip test with the spaced names a token may be: `remarkMentionChips`
 * reads them off the function it is given (`MentionChipTest` in
 * `@repo/chat-core/markdown-mentions`, declared again here because this
 * package doesn't depend on that one).
 */
export type MentionChipTest = ((token: string) => boolean) & {
  names?: readonly string[];
};

function withNames(
  test: (token: string) => boolean,
  names: readonly string[],
): MentionChipTest {
  return Object.assign((token: string) => test(token), { names });
}

const CHIP_NONE = (): boolean => false;
const CHIP_ALL = (): boolean => true;

/**
 * Which of a message's `@`-tokens to paint as a mention chip, from the
 * message's resolved `mentions` and its kind (`mentionChipFilter`). Stable
 * while neither changes, so a memoized parse keyed on it re-runs only when it
 * must.
 *
 * The function carries the names that hold a space ("Winston Hewitt", #3825),
 * from the same roster and roles, so the body chips the whole name.
 */
export function useMentionChips(message: {
  mentions?: readonly string[] | null;
  kind?: string | null;
  _status?: string;
}): MentionChipTest {
  const targets = useContext(MentionChipTargetsContext);
  const names = useMemo(
    () => spacedMentionNames(targets?.members, targets?.roleNames),
    [targets],
  );
  const key = (message.mentions ?? []).join(",");
  // An imported archive row resolves nobody by design, and the sender's own
  // row has no server answer until it is confirmed: both chip by token, as
  // every row did before 2026-11-07 (`mentionChipFilter`).
  const byToken =
    message.kind === "imported" ||
    (message._status !== undefined && message._status !== "confirmed");
  return useMemo(() => {
    if (byToken) return names.length > 0 ? withNames(CHIP_ALL, names) : CHIP_ALL;
    // Rows that pinged nobody share one function, so the roster or roles
    // landing does not re-parse every body in the channel (#2209).
    if (!key) return CHIP_NONE;
    return withNames(mentionChipFilter(key.split(","), targets), names);
  }, [byToken, key, targets, names]);
}

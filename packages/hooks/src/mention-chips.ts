import { createContext, useContext, useMemo } from "react";
import { mentionChipFilter, type MentionChipTargets } from "@repo/validation";

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
 * Which of a message's `@`-tokens to paint as a mention chip, from the
 * message's resolved `mentions` and its kind (`mentionChipFilter`). Stable while neither
 * changes, so a memoized parse keyed on it re-runs only when it must.
 */
const CHIP_NONE = (): boolean => false;
const CHIP_ALL = (): boolean => true;

export function useMentionChips(message: {
  mentions?: readonly string[] | null;
  kind?: string | null;
  _status?: string;
}): (token: string) => boolean {
  const targets = useContext(MentionChipTargetsContext);
  const key = (message.mentions ?? []).join(",");
  // An imported archive row resolves nobody by design, and the sender's own
  // row has no server answer until it is confirmed: both chip by token, as
  // every row did before 2026-11-07 (`mentionChipFilter`).
  const byToken =
    message.kind === "imported" ||
    (message._status !== undefined && message._status !== "confirmed");
  // Rows that pinged nobody share one function, so the roster or roles
  // landing does not re-parse every body in the channel (#2209).
  const settled = byToken ? CHIP_ALL : key ? null : CHIP_NONE;
  const resolved = useMemo(
    () => (key ? mentionChipFilter(key.split(","), targets) : CHIP_NONE),
    [key, targets],
  );
  return settled ?? resolved;
}

import { pollsGateOf, type PollsGate } from "@repo/chat-core/polls";
import { useCurrentChapter } from "@repo/hooks";
import { isModuleEnabled } from "@repo/validation";

/**
 * The Polls gate on mobile (#3012): the member view's `enabled_modules.polls`,
 * read the way `pollsGateOf` reads it, failing closed while the chapter is
 * unread or unreadable, for the poll card's Vote
 * (`components/chat/poll-card.tsx`). The composer's + reads the same member
 * view through `plusMenuModel` (`components/chat/use-composer-plus.tsx`,
 * #3865), which greys its Poll row while that read hasn't answered rather
 * than hiding it. It reads the member view, as `app/(app)/study.tsx`
 * does, never the officer-only config. A missing `polls` key is on.
 */
export function usePollsGate(): {
  gate: PollsGate;
  /** Reads the chapter again: the card's Retry when the gate is `"error"`. */
  recheck: () => void;
} {
  const chapterQuery = useCurrentChapter();
  return {
    gate: pollsGateOf({
      pollsEnabled:
        chapterQuery.data === undefined
          ? undefined
          : isModuleEnabled(chapterQuery.data?.enabled_modules, "polls"),
      fetchStatus: chapterQuery.fetchStatus,
    }),
    recheck: () => void chapterQuery.refetch(),
  };
}

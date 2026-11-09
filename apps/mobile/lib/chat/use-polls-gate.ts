import { pollsGateOf, type PollsGate } from "@repo/chat-core/polls";
import { useCurrentChapter } from "@repo/hooks";
import { isModuleEnabled } from "@repo/validation";

/**
 * The Polls gate on mobile (#3012): the member view's `enabled_modules.polls`,
 * read the way `pollsGateOf` reads it, failing closed while the chapter is
 * unread or unreadable. One read for both places that ask: the poll card's
 * Vote (`components/chat/poll-card.tsx`) and the composer's Poll offer
 * (`app/(app)/chat-thread.tsx`, #3701), so the two can't disagree about
 * whether Polls is on. It reads the member view, as `app/(app)/study.tsx`
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

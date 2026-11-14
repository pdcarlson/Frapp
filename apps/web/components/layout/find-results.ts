import {
  buildFindResults as buildSharedFindResults,
  type FindInput,
  type FindResult as SharedFindResult,
  type FindTarget,
} from "@repo/hooks/find-results";
import { chatDeepLink } from "@/lib/chat/chat-links";

/**
 * What the Find dialog lists: the shared list (`@repo/hooks`
 * `find-results.ts`, which the phone's Ask field reads too, #4904), each
 * row with the dashboard page it opens. The ranking, the caps and the date
 * hints are the shared builder's; only where a row goes is web's.
 */
export {
  ALL_GROUP_LIMIT,
  FIND_GROUPS,
  backworkHint,
  type FindFilter,
  type FindGroup,
  type FindInput,
} from "@repo/hooks/find-results";

export type FindResult = SharedFindResult & { href: string };

/** The dashboard page a result opens. */
function findHref(target: FindTarget): string {
  switch (target.type) {
    case "channel":
      return chatDeepLink({ channelId: target.channelId ?? undefined });
    case "message":
      return chatDeepLink({
        channelId: target.channelId,
        messageId: target.messageId ?? undefined,
      });
    case "member":
      return "/members";
    case "event":
      return "/events";
    case "backwork":
      return "/backwork";
  }
}

export function buildFindResults(input: FindInput): FindResult[] {
  return buildSharedFindResults(input).map((result) => ({
    ...result,
    href: findHref(result.target),
  }));
}

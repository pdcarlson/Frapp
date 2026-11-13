import {
  aiAvailableFrom,
  askAccessFrom,
  useActStatus,
  useAiChapterSettings,
  useAiConsent,
  useMyPermissions,
} from "@repo/hooks";
import { can, type AskAccess } from "@repo/validation";

/**
 * Which AI features this member can reach right now, on the phone
 * (`spec/behavior/ai.md` § Consent; ADR-28).
 *
 * There is one switch, and it is the server's: with `AI_ENABLED` off every AI
 * route answers 404 `ai.not_available`, `useAiConsent` reads that as `null`,
 * and nothing AI is drawn anywhere in the app. Over it sit the president's
 * switches for the chapter and the member's own `ai:use`. The phone used to
 * have a build flag of its own for Ask (`EXPO_PUBLIC_ASK_ENABLED`, over a
 * synthetic corpus); it is gone, so web and mobile can't disagree about
 * whether a chapter has Ask.
 *
 * Every value is `false` until its reads have answered: an entry point shows
 * only once the server has said yes, never on a guess, so nothing flashes in
 * and out on a slow read.
 */
export interface AiSurfaces {
  /** The server has AI at all. `undefined` while that is not yet known. */
  available: boolean | undefined;
  /** Ask Frapp: the chapter's switch is on and the member holds `ai:use`. */
  ask: boolean;
  /**
   * The same answer in three: `unknown` while a read behind it is in flight
   * or failed. A composer holds a message naming `@Frapp` on `unknown`, so a
   * question meant for Frapp is not posted while the app finds out (#4713).
   * Unlike `ready`, a failed read is not an answer here.
   */
  askAccess: AskAccess;
  /**
   * Catch me up (#3946): Ask is on, and the president has turned on channel
   * messages as a source. The same terms as web's `useChatCatchUpAvailable`.
   */
  catchUp: boolean;
  /** Minutes drafted from notes: the chapter's switch is on. */
  meetingNotes: boolean;
  /** Every read behind the answers above has settled, either way. */
  ready: boolean;
}

export function useAiSurfaces(): AiSurfaces {
  const consent = useAiConsent();
  const available = aiAvailableFrom(consent);
  const settings = useAiChapterSettings({ enabled: available === true });
  const permissionsQuery = useMyPermissions();
  const permissionsRead = Array.isArray(permissionsQuery.data?.permissions)
    ? permissionsQuery.data.permissions
    : undefined;
  const permissions = permissionsRead ?? [];
  const mayUse = available === true && can("ai:use", permissions);
  return {
    available,
    askAccess: askAccessFrom({
      available,
      ask: settings.data?.ask,
      permissions: permissionsRead,
    }),
    ready:
      available === false ||
      consent.isError ||
      (available === true && !settings.isPending && !permissionsQuery.isPending),
    ask: mayUse && settings.data?.ask === true,
    catchUp:
      mayUse &&
      settings.data?.ask === true &&
      settings.data.chat_source === true,
    // Not `ai:use`: the draft routes check `meetings:record`, the chapter's
    // switch and the member's own yes, and web offers drafting on the same
    // terms, so the phone does too.
    meetingNotes: available === true && settings.data?.meeting_notes === true,
  };
}

/**
 * Whether the Ask sheet asks for proposal cards (#718): Ask is on here and
 * the member holds `ai:act`. Both are already loaded, so a request typed the
 * moment the sheet opens still comes back as a card. The server decides
 * whether there is anything this member can have done.
 */
export function useMayAct(): boolean {
  const { ask } = useAiSurfaces();
  const permissionsQuery = useMyPermissions();
  return (
    ask &&
    Array.isArray(permissionsQuery.data?.permissions) &&
    can("ai:act", permissionsQuery.data.permissions)
  );
}

/**
 * The things this member can ask Frapp to do (#718), or an empty list. It
 * picks the request shown among the sheet's opening examples and nothing
 * else: whether a card is asked for is `useMayAct`. The server is asked only
 * for a member who holds `ai:act`, and only while `enabled` (the sheet is
 * open), so a member without Ask never sends the request.
 */
const NO_ACTIONS: readonly string[] = [];
export function useActActions(options?: {
  enabled?: boolean;
}): readonly string[] {
  // No request for a member without `ai:act`: the server would answer 403,
  // and every Ask sheet a member opened would count as a denied request.
  // Web's panel checks the same way first.
  const mayAct = useMayAct();
  const status = useActStatus({
    enabled: mayAct && (options?.enabled ?? true),
  });
  return mayAct && Array.isArray(status.data) ? status.data : NO_ACTIONS;
}

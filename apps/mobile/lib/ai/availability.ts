import {
  aiAvailableFrom,
  useAiChapterSettings,
  useAiConsent,
  useMyPermissions,
} from "@repo/hooks";
import { can } from "@repo/validation";

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
  const permissions = Array.isArray(permissionsQuery.data?.permissions)
    ? permissionsQuery.data.permissions
    : [];
  const mayUse = available === true && can("ai:use", permissions);
  return {
    available,
    ready:
      available === false ||
      consent.isError ||
      (available === true && !settings.isPending && !permissionsQuery.isPending),
    ask: mayUse && settings.data?.ask === true,
    // Not `ai:use`: the draft routes check `meetings:record`, the chapter's
    // switch and the member's own yes, and web offers drafting on the same
    // terms, so the phone does too.
    meetingNotes: available === true && settings.data?.meeting_notes === true,
  };
}

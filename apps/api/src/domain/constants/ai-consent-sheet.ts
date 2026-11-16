import type { AiFeatureFamily } from '../adapters/ai-call-context';

/**
 * What a member's Frapp AI answer is given against (`spec/behavior/ai.md` §
 * Consent, gate 2; ADR-28 decision 5).
 *
 * Since #4790 (Paul, 2026-11-13) the member answers on Meet Frapp AI, one
 * onboarding screen that names the companies Frapp AI works with in one line
 * and links the privacy policy, which carries the detail. `providers` is what
 * the screen names; `data` lists the kinds of data that are sent, which the
 * privacy policy's "Frapp AI" section names (`apps/landing/app/privacy/
 * page.tsx`) and store builds from before #4790 still draw on the old sheet.
 * **Adding a provider or a kind of data is a new version**: bump `version`,
 * and every member is asked again, because a Yes counts only for the version
 * it was given on (`user_ai_consents.sheet_version`). Change the privacy
 * policy's Frapp AI section in the same PR. `ai-consent-sheet.spec.ts` fails
 * when the providers or the kinds change without a bump, and when the model
 * catalog uses a provider this list does not name.
 *
 * Only the API reads it, as with the Terms version (`LEGAL_POLICY_VERSION`):
 * clients render the companies from `GET /v1/ai/consent`, so a store binary
 * compiled before a new version still shows, and answers, the current one.
 */
export interface AiConsentSheetProvider {
  key: 'anthropic' | 'google' | 'assemblyai';
  /** The company's own name, shown as is. */
  name: string;
}

export interface AiConsentSheetDataKind {
  key:
    | 'questions'
    | 'chapter_records'
    | 'roster'
    | 'channel_messages'
    | 'meetings';
  label: string;
}

export interface AiConsentSheet {
  version: number;
  providers: readonly AiConsentSheetProvider[];
  data: readonly AiConsentSheetDataKind[];
}

/**
 * Version 2 (2026-11-12, #712) added AssemblyAI, which the model catalog
 * routes a meeting's recording to for transcription. Nobody had answered
 * version 1: AI was off on every server. The transcription vendor is still
 * Paul's to pick (ADR-28, "What this record does not decide"); if the
 * bake-off picks Google, AssemblyAI leaves this list and the catalog
 * together, as another new version.
 */
export const AI_CONSENT_SHEET = {
  version: 2,
  providers: [
    { key: 'anthropic', name: 'Anthropic' },
    { key: 'google', name: 'Google' },
    { key: 'assemblyai', name: 'AssemblyAI' },
  ],
  data: [
    { key: 'questions', label: 'Questions you ask' },
    {
      key: 'chapter_records',
      // Events and tasks named 2026-11-16 (#4787): Ask's `events` and
      // `my_tasks` tools send them, and the privacy policy's Frapp AI section
      // already named both. The key is unchanged.
      // `ask-consent-coverage.spec.ts` maps every Ask tool to a row.
      label: 'Chapter documents, announcements, events and tasks',
    },
    {
      key: 'roster',
      // Groups, class year, service hours and study time named 2026-11-16
      // (#4787): Ask's `find_member`, `roster`, `my_hours`, `service_hours`
      // and `my_standing` tools send them. The key is unchanged.
      label:
        'Roster details: name, role, groups, class year, points, service hours and what they were for, study time, dues status and attendance. Never your phone number, email or address.',
    },
    {
      key: 'channel_messages',
      label: 'Your messages in chapter channels. Never direct messages.',
    },
    { key: 'meetings', label: 'Meeting notes, recordings and transcripts' },
  ],
} as const satisfies AiConsentSheet;

/**
 * The president's switches (`spec/behavior/ai.md` § Consent, gate 1), as the
 * API names them. Each is off until the president turns it on.
 */
export const AI_CHAPTER_SWITCHES = [
  'ask',
  'meeting_notes',
  'chat_source',
] as const;

export type AiChapterSwitch = (typeof AI_CHAPTER_SWITCHES)[number];

/**
 * Which switch a gateway call sits behind, by the catalog's family.
 *
 * `corpus` (embeddings) serves Ask's index and its questions, so it sits
 * behind Ask. Chat as a source is not a call's switch: it decides which
 * messages the corpus reads, where the corpus is read
 * (`AiConsentService.chatAuthorsWhoSaidYes`).
 */
export const AI_FAMILY_SWITCH: Readonly<
  Record<AiFeatureFamily, AiChapterSwitch>
> = {
  ask: 'ask',
  meetings: 'meeting_notes',
  corpus: 'ask',
  // The upload-time draft fill (#5233) reads only a file's redacted text, a
  // chapter document the sheet's `chapter_records` row already names, so it
  // stands behind the same switch and the uploader's own Yes.
  backwork: 'ask',
};

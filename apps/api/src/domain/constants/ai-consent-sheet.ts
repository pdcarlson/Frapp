import type { AiFeatureFamily } from '../adapters/ai-call-context';

/**
 * The AI sheet a member answers before any of their data reaches a model
 * (`spec/behavior/ai.md` § Consent, gate 2; ADR-28 decision 5).
 *
 * It names every provider Frapp sends member data to and every kind of data
 * that is sent. **Adding a provider or a kind of data is a new version**:
 * bump `version`, and every member is asked again, because a Yes counts only
 * for the version it was given on (`user_ai_consents.sheet_version`).
 * `ai-consent-sheet.spec.ts` fails when the providers or the kinds change
 * without a bump, and when the model catalog uses a provider the sheet does
 * not name.
 *
 * Only the API reads it, as with the Terms version (`LEGAL_POLICY_VERSION`):
 * clients render the sheet from `GET /v1/ai/consent`, so a store binary
 * compiled before a new version still shows, and answers, the current one.
 *
 * The labels are working copy for Paul's copy pass with the first screen
 * that shows the sheet (#4312, store answers #3297). Changing only a label is
 * not a new version; changing what a row covers is.
 */
export interface AiConsentSheetProvider {
  key: 'anthropic' | 'google';
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

export const AI_CONSENT_SHEET = {
  version: 1,
  providers: [
    { key: 'anthropic', name: 'Anthropic' },
    { key: 'google', name: 'Google' },
  ],
  data: [
    { key: 'questions', label: 'Questions you ask' },
    {
      key: 'chapter_records',
      label: 'Chapter documents and announcements',
    },
    {
      key: 'roster',
      label:
        'Roster details: name, role, points, dues status and attendance. Never your phone number, email or address.',
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
};

/**
 * The words around Frapp's AI settings and the member's AI sheet
 * (`spec/behavior/ai.md` § Consent, #4308; store gate #3297), shared by web
 * and mobile so the two never say different things about what leaves Frapp.
 *
 * What the sheet names (the providers and each kind of data) is not here: the
 * API serves it with its version (`GET /v1/ai/consent`), so an app built
 * before a new version still shows the current one. This module holds only
 * the framing around those rows, which does not change with a version.
 *
 * **Draft copy.** Paul approves the sheet's words before the release that
 * first sends member data to a model (#3297). Changing a sentence here is not
 * a new sheet version; changing what a row covers is, and that happens in the
 * API's `AI_CONSENT_SHEET`.
 *
 * What a No means is the table in `spec/behavior/ai.md` § Consent. The
 * sentences under `noMeans` must say the same thing, so the sheet never
 * promises a No keeps more out than it does.
 */

/** The president's switches, as the API names them (`AI_CHAPTER_SWITCHES`). */
export type AiChapterSwitchKey = "meeting_notes" | "ask" | "chat_source";

export interface AiSwitchCopy {
  key: AiChapterSwitchKey;
  label: string;
  description: string;
  /**
   * Shown under the switch while the feature has no screen in the app yet.
   * The switch is still stored and read by the server, so turning it on now
   * means the feature is on for the chapter the day it ships. Set to `null`
   * by the slice that ships the feature (Ask: #450).
   */
  notYetInApp: string | null;
  /** The switch this one only matters under, drawn nested beneath it. */
  dependsOn?: AiChapterSwitchKey;
}

/**
 * In the order the settings page draws them: the beta feature first, then
 * Ask and the one switch that only changes what Ask reads.
 */
export const AI_SWITCHES: readonly AiSwitchCopy[] = [
  {
    key: "meeting_notes",
    label: "Minutes from notes",
    description:
      "An officer pastes or types the meeting's notes and gets a first draft of the minutes to fix and post, with tasks suggested from it. Never for Standards meetings.",
    notYetInApp: null,
  },
  {
    key: "ask",
    label: "Ask Frapp",
    description:
      "Members ask a question and get an answer from the chapter's documents, announcements and posted minutes, with the sources it used.",
    notYetInApp:
      "Ask Frapp comes in a later update. If it's on, members can use it the day it arrives.",
  },
  {
    key: "chat_source",
    label: "Include channel messages",
    description:
      "Ask Frapp also reads messages in chapter channels, only from members who said yes. Never direct messages.",
    notYetInApp: null,
    dependsOn: "ask",
  },
];

export const AI_SETTINGS_COPY = {
  title: "AI",
  /** `{providers}` is the sheet's providers, joined with {@link joinNames}. */
  description: (providers: string) =>
    `These features send chapter information to ${providers}. Each is off until the president turns it on, and each member is asked once before anything of theirs is sent.`,
  presidentOnly: "Only the chapter president can turn these on or off.",
  dependsOnAsk: "Turn on Ask Frapp first.",
  lastChanged: (date: string) => `Last changed ${date}.`,
  turnedOn: (label: string) => `${label} turned on`,
  turnedOff: (label: string) => `${label} turned off`,
  saveFailed: "Couldn't change the AI setting",
  loadFailed: "Couldn't load the chapter's AI settings",
} as const;

export const AI_CONSENT_COPY = {
  title: "Use AI features in Frapp?",
  titleChanged: "What Frapp's AI uses has changed",
  /** `{providers}` is the sheet's providers, joined with {@link joinNames}. */
  intro: (providers: string) =>
    `Some Frapp features, like drafting minutes from meeting notes, use AI from ${providers}. Nothing of yours is sent to them unless you say yes.`,
  introChanged: (providers: string) =>
    `Frapp's AI now uses ${providers}, or sends a kind of information it didn't before. Your earlier answer no longer counts, so read it again and answer.`,
  sentToHeading: "Sent to",
  dataHeading: "What can be sent",
  noHeading: "If you say no",
  noMeans: [
    "You can't use AI features.",
    "Your messages in channels are left out.",
    "Chapter documents, announcements and roster details, and minutes that name you, can still be used once your president turns a feature on. They are the chapter's records.",
  ],
  changeLater: "You can change your answer any time in Settings.",
  yes: "Yes, use AI",
  no: "No",
  saveFailed: "Couldn't save your answer",
  /** The personal Settings section. */
  settingsTitle: "AI",
  settingsSwitch: "Use AI features",
  answeredYes: (date: string) => `You said yes on ${date}.`,
  answeredNo: (date: string) => `You said no on ${date}.`,
  unanswered: "You haven't answered yet, which counts as no.",
  changedSince:
    "What Frapp's AI uses has changed since you answered, so your earlier answer no longer counts.",
  turnedOn: "AI features are on for you",
  turnedOff: "AI features are off for you",
} as const;

/** `["Anthropic", "Google"]` → `"Anthropic and Google"`. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A stored timestamp as the day it fell on where the reader is, written out
 * (`November 12, 2026`), per the product's date rule: no "Nov 12", no
 * "Yesterday".
 */
export function formatAiAnswerDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

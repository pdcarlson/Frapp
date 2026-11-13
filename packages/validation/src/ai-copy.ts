/**
 * The words around Frapp AI, shared by web and mobile so the two never say
 * different things about it (`spec/behavior/ai.md` § Consent).
 *
 * The member meets Frapp AI on one screen, "Meet Frapp AI" (#4790, Paul
 * 2026-11-13): during onboarding, once on next open for an account that
 * never answered, and at an AI entry point for a member who chose Not now.
 * It says what Frapp AI does in three lines, names the companies it works
 * with in one, and links the privacy policy, which carries the detail.
 * Continue is the member's Yes; Not now is a No they can change in
 * Settings. Paul's rule for the wording: say no more about the process than
 * the member needs.
 *
 * The companies are not here: the API serves them (`GET /v1/ai/consent`,
 * `sheet.providers`), so an app built before a provider changes still names
 * the current ones.
 */

/** The president's switches, as the API names them (`AI_CHAPTER_SWITCHES`). */
export type AiChapterSwitchKey = "meeting_notes" | "ask" | "chat_source";

export interface AiSwitchCopy {
  key: AiChapterSwitchKey;
  label: string;
  description: string;
  /** The switch this one only matters under, drawn nested beneath it. */
  dependsOn?: AiChapterSwitchKey;
}

/**
 * In the order the settings page draws them: the beta feature first, then
 * Ask and the switch that lets Ask and summaries read channel messages.
 */
export const AI_SWITCHES: readonly AiSwitchCopy[] = [
  {
    key: "meeting_notes",
    label: "Minutes from notes",
    description:
      "An officer pastes or types the meeting's notes and gets a first draft of the minutes to fix and post, with tasks suggested from it. Never for Standards meetings.",
  },
  {
    key: "ask",
    label: "Ask Frapp",
    description:
      "Members ask a question and get an answer from the chapter's documents, announcements and posted minutes, with the sources it used.",
  },
  {
    key: "chat_source",
    label: "Include channel messages",
    description:
      "Ask Frapp also reads messages in chapter channels, and members can ask for a summary of a channel's new messages or of a thread. Only messages from members who have Frapp AI on. Never direct messages.",
    dependsOn: "ask",
  },
];

export const AI_SETTINGS_COPY = {
  title: "AI",
  /** `{providers}` is the sheet's providers, joined with {@link joinNames}. */
  description: (providers: string) =>
    `These features send chapter information to ${providers}. Each is off until the president turns it on, and each member chooses for themselves whether Frapp AI is on.`,
  presidentOnly: "Only the chapter president can turn these on or off.",
  dependsOnAsk: "Turn on Ask Frapp first.",
  lastChanged: (date: string) => `Last changed ${date}.`,
  turnedOn: (label: string) => `${label} turned on`,
  turnedOff: (label: string) => `${label} turned off`,
  saveFailed: "Couldn't change the AI setting",
  loadFailed: "Couldn't load the chapter's AI settings",
  offlineTitle: "AI settings unavailable offline",
  offlineDescription: "Reconnect to see which AI features are on.",
  retryLater: "Retry in a moment.",
} as const;

/** One line of what Frapp AI does, on the Meet Frapp AI screen. */
export interface FrappAiPoint {
  key: "ask" | "catch_up" | "nudge";
  text: string;
}

export const FRAPP_AI_COPY = {
  title: "Meet Frapp AI",
  points: [
    {
      key: "ask",
      text: "Ask anything about your chapter and get an answer with its sources.",
    },
    { key: "catch_up", text: "Catch up on a busy channel in a few lines." },
    {
      key: "nudge",
      text: "Get a nudge when something needs you, with a place to start.",
    },
  ] as readonly FrappAiPoint[],
  /**
   * The one line that makes Continue an explicit yes (Apple 5.1.2(i)): who
   * it works with, and that Continue turns it on. `forChapter` is a
   * president whose chapter has never had its AI switches set: their
   * Continue turns them on too, and the line says so.
   */
  disclosure: (providers: string, forChapter: boolean) =>
    forChapter
      ? `Frapp AI works with ${providers}. Continuing turns it on for you and your chapter.`
      : `Frapp AI works with ${providers}. Continuing turns it on for your account.`,
  privacyLink: "Privacy policy",
  continue: "Continue",
  notNow: "Not now",
  saveFailed: "Couldn't turn on Frapp AI. Try again.",
  loadFailed: "Couldn't load your Frapp AI setting",
  offlineTitle: "Frapp AI setting unavailable offline",
  offlineDescription: "Reconnect to see whether Frapp AI is on.",
  /** Settings: the member's own switch. */
  settingsTitle: "Frapp AI",
  settingsSwitch: "Frapp AI",
  settingsCaption: (providers: string) => `Works with ${providers}.`,
  turnOffFailed: "Couldn't turn off Frapp AI",
  turnedOn: "Frapp AI is on",
  turnedOff: "Frapp AI is off",
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

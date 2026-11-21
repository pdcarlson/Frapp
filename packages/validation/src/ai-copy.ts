import { AI_MINIMUM_AGE } from "./legal";
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
export type AiChapterSwitchKey =
  | "meeting_notes"
  | "ask"
  | "chat_source"
  | "nudges";

export interface AiSwitchCopy {
  key: AiChapterSwitchKey;
  label: string;
  description: string;
  /**
   * The phone's line under the switch: the same promise in a row's width
   * (Chapter settings, #4789). Web draws `description`.
   */
  short: string;
  /** The switch this one only matters under, drawn nested beneath it. */
  dependsOn?: AiChapterSwitchKey;
}

/**
 * In the order the settings page draws them: the beta feature first, then
 * Ask and the switch that lets Ask and summaries read channel messages, then
 * nudges, the one that starts on (Paul, 2026-11-17).
 */
export const AI_SWITCHES: readonly AiSwitchCopy[] = [
  {
    key: "meeting_notes",
    label: "Minutes from notes",
    description:
      "An officer pastes or types the meeting's notes and gets a first draft of the minutes to fix and post, with tasks suggested from it. Never for Standards meetings.",
    short:
      "A first draft of the minutes from an officer's notes. Never for Standards.",
  },
  {
    key: "ask",
    label: "Ask Frapp",
    description:
      // Announcements are chat (#4915): they reach Ask only with "Include
      // channel messages" on, so this switch doesn't name them.
      "Members ask a question and get an answer from the chapter's documents, posted minutes and records, with the sources it used.",
    short:
      "Members ask and get answers from the chapter's documents, minutes and records.",
  },
  {
    key: "chat_source",
    label: "Include channel messages",
    description:
      "Ask Frapp also reads messages in chapter channels, and members can ask for a summary of a channel's new messages or of a thread. Only messages from members who have Frapp AI on. Never direct messages.",
    short:
      "Ask and channel summaries read chapter channels. Only members with Frapp AI on, never DMs.",
    dependsOn: "ask",
  },
  {
    key: "nudges",
    label: "Nudges on Activity",
    description:
      "Frapp puts a short card on a member's Activity when one of their own tasks is coming due, late or sent back, with a place to start, and says thanks when they finish on time.",
    short:
      "A short card on a member's Activity when one of their tasks could use a word.",
  },
];

/** The chapter's switches as the API serves them; a missing one reads as off. */
export type AiChapterSwitchValues = Partial<
  Record<AiChapterSwitchKey, boolean>
>;

/**
 * How one switch draws, the same on web and the phone (#4789): its own
 * value; whether the switch it depends on is off (`parentOff`, drawn
 * muted); and whether it waits on that parent (`waitsOnParent`: off, so it
 * can't be turned on until the parent is, and says so). A switch whose
 * parent is off but which is still on stays usable, so a president can
 * clear what it would do.
 */
export function aiSwitchState(
  entry: AiSwitchCopy,
  settings: AiChapterSwitchValues | null | undefined,
) {
  const checked = settings?.[entry.key] === true;
  const parentOff =
    entry.dependsOn !== undefined && settings?.[entry.dependsOn] !== true;
  return { checked, parentOff, waitsOnParent: parentOff && !checked };
}

/**
 * How many of the chapter's AI features are working: a switch counts only
 * when it and the one it depends on are on, since Include channel messages
 * does nothing with Ask off (the server keeps it either way).
 */
export function aiSwitchesInEffect(
  settings: AiChapterSwitchValues | null | undefined,
): number {
  return AI_SWITCHES.filter((entry) => {
    const { checked, parentOff } = aiSwitchState(entry, settings);
    return checked && !parentOff;
  }).length;
}

export const AI_SETTINGS_COPY = {
  title: "AI",
  /**
   * No company names (Paul, 2026-11-17: "we don't need to say it works with
   * Anthropic, Google, and AssemblyAI ... that lives in the privacy policy").
   * They stay on Meet Frapp AI, where the member's yes is given.
   */
  description:
    "Each is on unless the president turns it off, and each member chooses for themselves whether Frapp AI is on.",
  /** The phone's footnote under the switches in Chapter settings. */
  phoneFootnote:
    "Each member also chooses for themselves whether Frapp AI is on.",
  /** The phone's row in a member's own Settings that opens these switches. */
  chapterRow: "Chapter AI",
  /** That row's value: how many of the chapter's switches are on. */
  chapterRowValue: (on: number) => `${on} on`,
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
   * it works with, and that Continue confirms you're 18 or older and turns
   * it on (#5627: members may join at 17, AI
   * stays 18, `AI_MINIMUM_AGE`). It names only the member's account: the
   * chapter's switches start on (#5294), so it no longer has a "for you and
   * your chapter" form.
   */
  disclosure: (providers: string) =>
    `Frapp AI works with ${providers}. Continuing confirms you're ${AI_MINIMUM_AGE} or older and turns it on for your account.`,
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
  /**
   * What it does, not who it works with: the companies are named on Meet
   * Frapp AI, which turning the switch on opens, and in the privacy policy
   * (Paul, 2026-11-17).
   */
  settingsCaption:
    "Ask questions, catch up on channels, draft minutes and get nudges.",
  /** The phone's Settings section that holds Frapp AI and nudges. */
  settingsSection: "AI",
  /** The line under that section; `privacyLink` is the linked words. */
  settingsFootnote: "What Frapp AI reads and who it works with is in the",
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

/**
 * Whether to ask for push, and what the member last said.
 *
 * `spec/ui/mobile/patterns.md` § Push notifications: onboarding asks on its own
 * step (s03's second beat, or chapter setup's), never as a cold launch-time OS
 * prompt; the OS prompt fires only after the member taps "Turn on
 * notifications"; and a "Not now" comes back once, days later, as the chat
 * home's reminder.
 *
 * The rules that fall out of that, and why this module exists rather than a
 * boolean in a screen:
 *
 * - **The OS prompt is downstream of our ask.** iOS gives an app exactly one
 *   permission dialog ever; spending it on a cold launch is unrecoverable. So
 *   nothing calls `requestPushPermission()` except `acceptPrimer()` below,
 *   which onboarding's step, the chat home's reminder (both through
 *   `answerPushAsk()`) and a tap on s16 Settings' push switch all go through.
 * - **When no prompt can appear, the ask opens the phone's settings**, and says
 *   so on its button, rather than asking an OS that will silently refuse.
 * - **"Not now" has to stick, but not forever.** The step never comes back;
 *   the chat home asks once more after `PUSH_REMINDER_DELAY_MS`
 *   (`shouldOfferReminder`), and after that Settings is the only place.
 *
 * The same reasoning already shipped for location in
 * `components/study/location-primer-sheet.tsx` (s10) — this is its push sibling.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking } from "react-native";
import { requestPushPermission } from "@/lib/notifications/push";
import {
  pushIsOn,
  pushTapAsks,
  readPushState,
  type PushState,
} from "./push-state";
import { notifyPushPermissionGranted } from "./push-token-lifecycle";

export const PUSH_PRIMER_STORAGE_KEY = "frapp.mobile.push-primer";
/** When the member said "Not now", as epoch milliseconds. */
export const PUSH_PRIMER_DECLINED_AT_KEY =
  "frapp.mobile.push-primer.declined-at";
/** `"done"` once the chat home's one reminder has been answered either way. */
const PUSH_REMINDER_STORAGE_KEY = "frapp.mobile.push-reminder";

/**
 * How long after a "Not now" the chat home asks once more. Long enough that
 * the member has lived in the chapter for a few days (missed a ping or two,
 * seen what the app is for), short enough that it lands before the first
 * required event most chapters hold in a week.
 */
export const PUSH_REMINDER_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

/** `"unasked"` is the absence of a stored decision, not a stored value. */
export type PrimerDecision = "unasked" | "declined" | "accepted";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;

export function parsePrimerDecision(value: unknown): PrimerDecision {
  return value === "declined" || value === "accepted" ? value : "unasked";
}

export async function readPrimerDecision(
  storage: Storage = AsyncStorage,
): Promise<PrimerDecision> {
  try {
    return parsePrimerDecision(await storage.getItem(PUSH_PRIMER_STORAGE_KEY));
  } catch {
    // Unknown reads as unasked: offering a primer one extra time is a far
    // smaller failure than never offering it at all.
    return "unasked";
  }
}

/**
 * Every surface that shows an ask keeps its own read of the stored answers,
 * and a tab screen stays mounted while the member answers somewhere else
 * (s16 Settings' push switch, say). So each write tells the others, and a
 * reminder still on screen after an answer elsewhere is taken down.
 */
const storedAnswerListeners = new Set<() => void>();

export function onStoredAnswerChange(listener: () => void): () => void {
  storedAnswerListeners.add(listener);
  return () => {
    storedAnswerListeners.delete(listener);
  };
}

function storedAnswerChanged() {
  for (const listener of storedAnswerListeners) listener();
}

async function recordPrimerDecision(
  decision: Exclude<PrimerDecision, "unasked">,
  storage: Storage = AsyncStorage,
): Promise<void> {
  try {
    await storage.setItem(PUSH_PRIMER_STORAGE_KEY, decision);
  } catch {
    // Cosmetic. The worst case is the primer offering itself again.
  }
  storedAnswerChanged();
}

/**
 * The member accepting the primer: records the decision, then shows the OS
 * prompt. Resolves with whether the OS granted permission, and never rejects:
 * a prompt the OS failed to show counts as not granted.
 *
 * The one place the two steps are paired, so onboarding's step, the chat
 * home's reminder (both through `answerPushAsk()`) and s16 Settings' push
 * switch accept the same way. The record comes first so that a crash
 * mid-prompt still counts as asked; otherwise the ask could come back
 * offering a "Turn on" the OS would now ignore. `onRecorded` runs between the
 * two, which is where the reminder hides itself.
 *
 * A grant also asks the push runtime to register the token again
 * (`onPushPermissionGranted`, #2617), because the sign-in register ran before
 * this prompt existed.
 */
export async function acceptPrimer(onRecorded?: () => void): Promise<boolean> {
  await recordPrimerDecision("accepted");
  onRecorded?.();
  const granted = await requestPushPermission().catch(() => false);
  if (granted) notifyPushPermissionGranted();
  return granted;
}

/**
 * "Not now": recorded as declined, with the time, so the chat home's reminder
 * can wait `PUSH_REMINDER_DELAY_MS` before asking again.
 */
export async function declinePrimer(
  storage: Storage = AsyncStorage,
  now: number = Date.now(),
): Promise<void> {
  try {
    await storage.setItem(PUSH_PRIMER_DECLINED_AT_KEY, String(now));
  } catch {
    // The reminder then reads the decline as old and may ask a little early.
  }
  // The decision last, so a listener re-reading both sees the time too.
  await recordPrimerDecision("declined", storage);
}

export async function readDeclinedAt(
  storage: Storage = AsyncStorage,
): Promise<number | null> {
  try {
    const raw = await storage.getItem(PUSH_PRIMER_DECLINED_AT_KEY);
    const at = raw === null ? NaN : Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

export async function readReminderDone(
  storage: Storage = AsyncStorage,
): Promise<boolean> {
  try {
    return (await storage.getItem(PUSH_REMINDER_STORAGE_KEY)) === "done";
  } catch {
    // Unknown reads as done: a reminder that never shows costs less than one
    // that comes back on every launch.
    return true;
  }
}

export async function recordReminderDone(
  storage: Storage = AsyncStorage,
): Promise<void> {
  try {
    await storage.setItem(PUSH_REMINDER_STORAGE_KEY, "done");
  } catch {
    // Cosmetic. The worst case is the reminder offering itself again.
  }
  storedAnswerChanged();
}

/** What answering the ask did: the OS prompt's answer, or the phone's settings opened. */
export type PushAskOutcome = "allowed" | "denied" | "settings";

/**
 * "Turn on notifications", from any surface that asks (onboarding, the chat
 * home's reminder). It reads the phone's answer again first, as Settings'
 * switch does, because the member may have changed it since the button drew.
 *
 * - Already on: nothing to ask; recorded as accepted.
 * - The OS can still show its dialog: shows it (`acceptPrimer()`).
 * - No dialog can appear (iOS after an earlier "Don't Allow", Android after a
 *   second one, Android 13+ with the app's notifications blocked, or its
 *   channel switched off): opens the phone's settings for this app, the only
 *   place left. No system dialog answered anything there, and the member may
 *   back out with push still off, so it counts as a deferral, like "Not now":
 *   the chat home's reminder can still ask once, later.
 *
 * `onRecorded` runs once the answer is stored, before the OS dialog or the
 * settings app opens. Never rejects.
 */
export async function answerPushAsk(
  onRecorded?: () => void,
): Promise<PushAskOutcome> {
  const push: PushState | null = await readPushState().catch(() => null);
  if (push && pushIsOn(push)) {
    await recordPrimerDecision("accepted");
    onRecorded?.();
    return "allowed";
  }
  if (!push || pushTapAsks(push)) {
    const granted = await acceptPrimer(onRecorded).catch(() => false);
    return granted ? "allowed" : "denied";
  }
  await declinePrimer();
  onRecorded?.();
  await Linking.openSettings().catch(() => undefined);
  return "settings";
}

export interface PrimerVisibilityInput {
  /** `isPushAvailable()` — the module loaded and a project id is configured. */
  isAvailable: boolean;
  /** The phone's answer (`readPushState()`). `null` while unread or unreadable. */
  push: PushState | null;
  decision: PrimerDecision;
}

/**
 * Whether onboarding's notifications step has anything to offer.
 *
 * Hidden once push is on (there is nothing left to ask), and once the member
 * has answered it. A "Not now" comes back once, later, as the chat home's
 * reminder (`shouldOfferReminder`), never as this step again.
 *
 * Also **hidden when push is unavailable** (#2299): `isPushAvailable()` is
 * false, for any of the causes `spec/ui/mobile/patterns.md` § Push
 * notifications lists. The step's only function is "Turn on", and nothing on
 * s03 can make the build able to push, so a step there could only disable
 * itself and apologise, which is the placeholder App Review Guideline 2.1
 * rejects. `spec/ui/design-system/README.md` §5 rule 4 hides it, like the
 * Ask entry for a member without Ask. Settings (s16) still states the reason on
 * its push row, which is where a member who wonders why goes.
 */
export function shouldOfferPrimer({
  isAvailable,
  push,
  decision,
}: PrimerVisibilityInput): boolean {
  if (decision !== "unasked") return false;
  // Not implied by the permission read below. A build that loads the native
  // module but has no EAS project id can still read permission as not
  // granted, and would offer a "Turn on" that grants permission but can never
  // register a token.
  if (!isAvailable) return false;
  // Available but not yet read — do not flash a step that may be about to
  // resolve to "already on".
  if (push === null) return false;
  // `pushIsOn`, not `granted`: Android 13+ can report the permission granted
  // with the app's notifications blocked, and that phone shows nothing.
  return !pushIsOn(push);
}

export interface ReminderVisibilityInput extends PrimerVisibilityInput {
  declinedAt: number | null;
  reminderDone: boolean;
  now: number;
}

/**
 * Whether the chat home asks once more. It is the one come-back for a member
 * whose push is off:
 *
 * - **"Not now" in onboarding**, after `PUSH_REMINDER_DELAY_MS`. A decline
 *   with no stored time (written before the time was kept) counts as old.
 * - **Never asked**: a member who joined before onboarding had its own
 *   notifications step, or on a build where the step was a skippable card.
 *
 * Not after "Turn on" whatever the OS said: a "Don't Allow" in the system
 * dialog is the member's answer, and Settings (s16) is where it is undone.
 * ("Open Settings", where no dialog appeared, is stored as a deferral.)
 * And only once: answering it either way (or closing it) is final.
 */
export function shouldOfferReminder({
  isAvailable,
  push,
  decision,
  declinedAt,
  reminderDone,
  now,
}: ReminderVisibilityInput): boolean {
  if (reminderDone || !isAvailable || push === null) return false;
  if (pushIsOn(push)) return false;
  if (decision === "accepted") return false;
  if (decision === "declined" && declinedAt !== null) {
    return now - declinedAt >= PUSH_REMINDER_DELAY_MS;
  }
  return true;
}

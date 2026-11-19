import { extractInviteToken } from "./invite-token";

/**
 * The invite carried through an app install by the clipboard (#5626, epic
 * #5624; Paul's pick 2026-11-19: "Copy on install, Paste fallback").
 *
 * iOS can't hand a link to an app that wasn't installed when it was tapped,
 * short of a third-party link service. So web `/join` on a phone copies the
 * invite link as the member taps Get Frapp, and the app's first screens offer
 * Paste. On iOS 16 and later that is the system Paste button, which reads the
 * clipboard without the "pasted from Safari" banner; anywhere, the clipboard
 * is read only on a tap.
 */

/** What the invite tokens the API mints look like (`randomUUID()`). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The invite in what a member pasted, or null when it holds none.
 *
 * Stricter than the join field's `extractInviteToken`, which takes any long
 * word as a bare token: a paste is whatever happened to be on the clipboard
 * (a tracking number, a copied sentence), and opening the invite card on it
 * only to say "This invite link doesn't work" is the wrong answer. Every
 * invite the API mints is a UUID, in a join link or alone, so anything else
 * is "That isn't a Frapp invite", said on the screen the member pasted on.
 */
export function pastedInviteToken(
  text: string | null | undefined,
): string | null {
  const token = extractInviteToken(text);
  return token !== null && UUID_PATTERN.test(token) ? token : null;
}

/** The phone's Paste, on sign-in and on the join question. */
export const INVITE_PASTE_COPY = {
  title: "Joining a chapter?",
  /** The line on the join question and the sign-in strip, before a paste. */
  lede: "If you tapped an invite link before installing Frapp, paste it here.",
  /** On the join question when an emailed invite is offered above it. */
  ledeWithOffers: "Have a different invite link? Paste it here.",
  /** No longer than `lede`, which it replaces in place. */
  notInvite: "That isn't a Frapp invite. Copy the whole link, then tap Paste.",
  /** Android's own Paste found nothing on the clipboard. */
  empty: "Nothing to paste yet. Copy the invite link, then tap Paste.",
  startingPrompt: "Starting a chapter?",
  startingAction: "Create a chapter",
  startingHint: "Opens chapter setup.",
} as const;

/**
 * Web `/join` on a phone, the two steps (`AppHandoff`): what step 1 says
 * before and after Get copies the invite, and step 2.
 */
export function installHandoffCopy(appName: string): {
  getDetail: string;
  copied: string;
  copyFailed: string;
  pasteTitle: string;
  pasteDetail: string;
} {
  return {
    getDetail: `Tapping Get ${appName} copies your invite for the app.`,
    copied: `Invite copied. When ${appName} opens, tap Paste.`,
    copyFailed: `Couldn't copy your invite. Once ${appName} is installed, come back here and tap Open in ${appName}.`,
    pasteTitle: "Paste your invite",
    pasteDetail: `Open ${appName} and tap Paste. Already had the app? Open it from here.`,
  };
}

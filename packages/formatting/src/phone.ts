import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js/min";
import { isPhoneNumber, PHONE_MAX_DIGITS } from "@repo/validation";

/**
 * A member's phone number (#5798): formatted as they type it, stored normalized
 * (E.164, `+15185550142`), and shown formatted wherever it appears. Web, the
 * phone and the API's save all use these, so a number reads the same in every
 * place. What counts as a phone number at all is `isPhoneNumber`
 * (`@repo/validation`); these only shape what it accepts.
 *
 * A number without a `+` is read as a US number: no chapter carries a locale
 * yet (`spec/behavior/members.md` § Profiles, the Phone bullet). One that
 * starts with `+` formats in its own country's style.
 *
 * `libphonenumber-js`'s `min` metadata is about 36 KB gzipped (measured with
 * esbuild, 2026-11-20).
 */

/** The country a number without a `+` is read in. */
const PHONE_DEFAULT_COUNTRY = "US";

/** A US number's 10 digits: an area code never starts 0 or 1. */
const NANP_NATIONAL = /^[2-9]\d{9}$/;

/** A 7-digit local number, `555-0142`, which has no area code to format. */
const LOCAL_SEVEN = /^\d{7}$/;

function parse(value: string) {
  const trimmed = value.trim();
  if (!isPhoneNumber(trimmed)) return null;
  return parsePhoneNumberFromString(trimmed, PHONE_DEFAULT_COUNTRY) ?? null;
}

/**
 * A number shaped like a whole one, for display: a `+` number its country
 * could have, or 10 US digits in the North American shape. Fictional
 * `555-123-4567` numbers pass, so a test number still reads formatted.
 */
function displayable(value: string) {
  const parsed = parse(value);
  if (!parsed?.isPossible()) return null;
  if (parsed.countryCallingCode !== "1") return parsed;
  return NANP_NATIONAL.test(parsed.nationalNumber) ? parsed : null;
}

/**
 * What a value that doesn't read as a whole number keeps: a 7-digit local
 * number as `555-0142` (the as-you-type formatter leaves it half-grouped,
 * `(555) 014-2`), anything else trimmed as typed.
 */
function asTyped(value: string): string {
  const trimmed = value.trim();
  if (!isPhoneNumber(trimmed) || trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  return LOCAL_SEVEN.test(digits)
    ? `${digits.slice(0, 3)}-${digits.slice(3)}`
    : trimmed;
}

/**
 * The number to store: E.164 (`+15185550142`) when it is a valid number for
 * its country, else {@link asTyped}. Validity, not just length, so a national
 * number from elsewhere typed without its `+` (`0412 345 678`) isn't turned
 * into a US number that dials someone else. A value `isPhoneNumber` refuses
 * comes back trimmed for the caller's validation to refuse.
 */
export function normalizePhone(value: string): string {
  const parsed = parse(value);
  return parsed?.isValid() ? parsed.number : asTyped(value);
}

/**
 * A stored number as people read it: `(518) 555-0142` for a US or Canadian
 * number, `+44 20 7946 0958` for any other country. A value that doesn't read
 * as a whole number comes back as {@link asTyped} keeps it. Empty for none.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = displayable(value);
  if (!parsed) return asTyped(value);
  return parsed.countryCallingCode === "1"
    ? parsed.formatNational()
    : parsed.formatInternational();
}

/** What a Phone field shows after a keystroke, and where its caret goes. */
interface PhoneInputState {
  value: string;
  caret: number;
}

function significant(char: string, index: number): boolean {
  return (char >= "0" && char <= "9") || (char === "+" && index === 0);
}

/** Digits, the separators people type, and a leading `+`: nothing else. */
const PHONE_CHARACTERS = /^\s*\+?[0-9 ().-]*$/;

/**
 * Where the caret sits after an edit turned `previous` into `next`, for a field
 * that doesn't report it (React Native's `onChangeText`): the end of what
 * changed, found from the text the two still share at their ends.
 */
function inferCaret(previous: string, next: string): number {
  let suffix = 0;
  const room = Math.min(previous.length, next.length);
  while (
    suffix < room &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  let prefix = 0;
  while (prefix < room - suffix && previous[prefix] === next[prefix]) {
    prefix += 1;
  }
  return Math.max(prefix, next.length - suffix);
}

/**
 * Whether `next` is `previous` with one separator taken out (a `)`, space or
 * `-` the formatting added), and nothing else changed.
 */
function removedOneSeparator(previous: string, next: string): boolean {
  if (previous.length - next.length !== 1) return false;
  let at = 0;
  while (at < next.length && previous[at] === next[at]) at += 1;
  const removed = previous[at]!;
  if (significant(removed, at)) return false;
  return previous.slice(at + 1) === next.slice(at);
}

/**
 * Format a Phone field as the member types (#5798): `5185550142` becomes
 * `(518) 555-0142`, and `+442079460958` becomes `+44 20 7946 0958`.
 *
 * `next` is the field's text after the keystroke and `caret` where its caret
 * sat; without it, the caret is worked out from `previous`, else taken to be
 * at the end. The caret keeps its place among the digits, so an edit in the
 * middle doesn't throw it to the end.
 *
 * Pass `previous` (the text before the keystroke) so deleting a separator the
 * formatting added takes a digit instead of being put straight back:
 * Backspace takes the digit before it, and `deleted: "forward"` (the Delete
 * key) the digit after it. Only a single separator taken out counts, so a
 * paste over the field is never trimmed.
 *
 * Text with anything but digits, separators and a leading `+` (a letter, an
 * extension like `x12`) is left as typed, so Save refuses it with the field's
 * own message rather than gluing the extension's digits onto the number.
 */
export function formatPhoneInput(
  next: string,
  caret?: number,
  previous?: string,
  deleted: "backward" | "forward" = "backward",
): PhoneInputState {
  caret ??= previous === undefined ? next.length : inferCaret(previous, next);
  if (!PHONE_CHARACTERS.test(next)) return { value: next, caret };

  const leadingPlus = next.trimStart().startsWith("+");
  const start = next.length - next.trimStart().length;
  let chars: string[] = [];
  let before = 0;
  for (let i = 0; i < next.length; i += 1) {
    const char = next[i]!;
    if (!significant(char, i - start)) continue;
    chars.push(char);
    if (i < caret) before += 1;
  }

  if (previous !== undefined && removedOneSeparator(previous, next)) {
    if (deleted === "forward") {
      if (before < chars.length) chars.splice(before, 1);
    } else if (before > 0 && chars[before - 1] !== "+") {
      chars.splice(before - 1, 1);
      before -= 1;
    }
  }

  const digits = chars.filter((char) => char !== "+");
  if (digits.length > PHONE_MAX_DIGITS) {
    const over = digits.length - PHONE_MAX_DIGITS;
    chars = chars.slice(0, chars.length - over);
    before = Math.min(before, chars.length);
  }

  const raw = chars.join("");
  if (raw.length === 0 || raw === "+") {
    return { value: leadingPlus ? "+" : "", caret: leadingPlus ? 1 : 0 };
  }
  const value = new AsYouType(PHONE_DEFAULT_COUNTRY).input(raw);

  // The caret goes after the same count of digits (and `+`) as before.
  let seen = 0;
  let at = 0;
  if (before > 0) {
    for (let i = 0; i < value.length; i += 1) {
      if (significant(value[i]!, i)) seen += 1;
      if (seen === before) {
        at = i + 1;
        break;
      }
    }
    if (seen < before) at = value.length;
  }
  return { value, caret: at };
}

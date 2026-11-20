import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js/min";

/**
 * A member's phone number (#5798): formatted as they type it, stored normalized
 * (E.164, `+15185550142`), and shown formatted wherever it appears. Web, the
 * phone and the API's save all use these, so a number reads the same in every
 * place.
 *
 * A number without a `+` is read as a US number: no chapter carries a locale
 * yet (`spec/behavior/members.md` § Phone number). One that starts with `+`
 * formats in its own country's style.
 *
 * The `min` metadata is about 36 KB gzipped; it rides only in the screens that
 * show or edit a number.
 */

/** The country a number without a `+` is read in. */
const PHONE_DEFAULT_COUNTRY = "US";

/** The most digits a phone number has (E.164's cap). */
const PHONE_MAX_DIGITS = 15;

/** Only digits, the separators people type, and a leading `+`. */
const PHONE_SHAPE = /^\+?[0-9 ().-]+$/;

function parse(value: string) {
  const trimmed = value.trim();
  if (!PHONE_SHAPE.test(trimmed)) return null;
  const parsed = parsePhoneNumberFromString(trimmed, PHONE_DEFAULT_COUNTRY);
  return parsed?.isPossible() ? parsed : null;
}

/**
 * The number to store: E.164 (`+15185550142`) when it reads as a whole number,
 * else the value trimmed, so a short local number (`555-0142`) keeps what was
 * typed rather than being guessed at. Anything with letters or an extension
 * is left alone for the caller's validation to refuse.
 */
export function normalizePhone(value: string): string {
  return parse(value)?.number ?? value.trim();
}

/**
 * A stored number as people read it: `(518) 555-0142` for a US or Canadian
 * number, `+44 20 7946 0958` for any other country. A value that doesn't read
 * as a whole number comes back trimmed, as it was stored. Empty for none.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = parse(value);
  if (!parsed) return value.trim();
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
 * Format a Phone field as the member types (#5798): `5185550142` becomes
 * `(518) 555-0142`, and `+442079460958` becomes `+44 20 7946 0958`.
 *
 * `next` is the field's text after the keystroke and `caret` where its caret
 * sat; without it, the caret is worked out from `previous`, else taken to be
 * at the end. The caret keeps its place among the digits, so an edit in the middle
 * doesn't throw it to the end. Pass `previous` (the text before the keystroke)
 * so a backspace over a separator, the `)` or `-` the formatting added, takes
 * the digit before it instead of being put straight back.
 */
export function formatPhoneInput(
  next: string,
  caret?: number,
  previous?: string,
): PhoneInputState {
  caret ??= previous === undefined ? next.length : inferCaret(previous, next);
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

  // A backspace that only took a separator: take the digit before it too.
  if (
    previous !== undefined &&
    next.length < previous.length &&
    countSignificant(previous) === chars.length &&
    before > 0 &&
    chars[before - 1] !== "+"
  ) {
    chars.splice(before - 1, 1);
    before -= 1;
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

function countSignificant(value: string): number {
  const start = value.length - value.trimStart().length;
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (significant(value[i]!, i - start)) count += 1;
  }
  return count;
}

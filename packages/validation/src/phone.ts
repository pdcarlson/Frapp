import { PHONE_MAX_LENGTH } from "./field-limits";

/**
 * A member's own phone number (#3711): what the API accepts, and the links a
 * profile's Phone row opens. The number is stored as the member typed it
 * (trimmed), so `(518) 555-0142` reads back the way they wrote it; only the
 * links strip it to digits.
 */

/** The fewest and most digits a phone number has (E.164 caps it at 15). */
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

/** What the wording of a refused number says, on the API and both forms. */
export const PHONE_INVALID_MESSAGE =
  "Enter a phone number, like (518) 555-0142 or +44 20 7946 0958.";

/**
 * Whether `value` reads as one phone number: digits with the separators people
 * type between them (spaces, dashes, dots, parentheses), an optional leading
 * `+`, 7 to 15 digits, and at most {@link PHONE_MAX_LENGTH} characters. Letters
 * and a second `+` are refused, so an address or a note never lands where a
 * Call button dials it.
 */
export function isPhoneNumber(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > PHONE_MAX_LENGTH) return false;
  if (!/^\+?[0-9 ().-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "").length;
  return digits >= PHONE_MIN_DIGITS && digits <= PHONE_MAX_DIGITS;
}

/**
 * The number a `tel:` or `sms:` link carries: its digits, keeping a leading
 * `+`. Null when there is nothing to dial.
 */
export function phoneDialString(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/** `tel:` to call the number, `sms:` to text it. Null when there is none. */
export function phoneHref(
  value: string | null | undefined,
  kind: "call" | "text",
): string | null {
  const dial = phoneDialString(value);
  if (!dial) return null;
  return `${kind === "call" ? "tel" : "sms"}:${dial}`;
}

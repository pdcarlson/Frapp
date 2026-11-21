/**
 * What the app keeps of the check-in code's contract with the host screen
 * (s22) and the API.
 *
 * The QR itself is a link the phone's own camera opens (2026-11-13,
 * `@repo/validation` `check-in-link.ts`), so the app no longer parses a scanned
 * string: the link's route hands the screen its event and token. Left here are
 * the rotation window s22 counts down, and the shape of the typed fallback
 * code.
 */

/**
 * How long a code is the current one. Must match `CHECK_IN_TOKEN_WINDOW_MS` in
 * the API, which a spec reads from the API's source: the mint response says
 * when *this* code rotates, but not how long the server goes on accepting it
 * after that (at least one more window: one for a typed code, three for a
 * scanned link), which s22 needs to know whether a code it is holding still
 * redeems.
 */
export const CHECK_IN_TOKEN_WINDOW_MS = 30_000;

/**
 * Whether a typed string is plausibly a manual code, used only to enable the
 * submit control. The server is the authority on validity — this must never
 * grow into a client-side check of whether a code is *correct*, which it cannot
 * know without the signing secret.
 */
export function isPlausibleManualCode(input: string): boolean {
  return input.replace(/[^0-9A-Za-z]/g, "").length === 5;
}

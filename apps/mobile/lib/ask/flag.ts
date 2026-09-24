/**
 * Whether this build includes Ask (s17) at all.
 *
 * ## There is no feature-flag mechanism in this repo
 *
 * Nothing here ships a flag service, a `flags` table, or a remote-config
 * client, and `package.json` is frozen under #937's hotspot protocol, so adding
 * one is an integrator PR rather than part of a screen slice. The only
 * runtime-config path mobile has is an `EXPO_PUBLIC_*` variable read through a
 * small helper: `lib/more/legal.ts` uses that shape for the legal base URL and
 * `lib/payments/stripe.ts` uses it for the publishable key. This is the same
 * shape a third time, and it is the whole mechanism.
 *
 * `EXPO_PUBLIC_` is the prefix Expo inlines into the bundle at build time, so
 * the value is fixed for a given build. It is not a per-chapter or per-member
 * switch and must never be described to a member as one.
 *
 * ## Default off, and strictly so
 *
 * Only the exact strings `"1"` and `"true"` switch Ask on. Everything else —
 * unset, empty, `"0"`, `"yes"`, `"TRUE"` — leaves it off. The strictness is
 * deliberate rather than fussy: the corpus behind Ask is synthetic
 * (`lib/ask/corpus.ts`), so a loose truthiness check that accepted a stray
 * value would put invented dues figures in front of a real member. When the
 * parse is ambiguous the safe answer is off.
 *
 * The read happens inside the function rather than at module scope, following
 * `publishableKey()` in `lib/payments/stripe.ts`: a module-scope constant is
 * captured once at import and cannot be exercised by a spec that mutates
 * `process.env`.
 */

/**
 * The single variable that governs Ask. Named once, so the spec can mutate it.
 *
 * **The read below must stay a static `process.env.EXPO_PUBLIC_ASK_ENABLED`.**
 * `babel-preset-expo`'s inline-env-vars plugin only rewrites a member expression
 * whose *property name* literally starts with `EXPO_PUBLIC_`; for a computed
 * `process.env[ASK_FLAG_ENV_KEY]` it reads the identifier name instead, the
 * check fails, and the access is left untouched. React Native then initializes
 * `global.process.env` to `{}` plus `NODE_ENV`, so the value is always
 * `undefined` on device no matter what the build set — Ask could never be turned
 * on, and no spec would catch it, because vitest runs on Node where
 * `process.env` is a live object. Every other env read in this app
 * (`frapp-client.tsx`, `more/legal.ts`, `payments/stripe.ts`, `supabase.ts`)
 * uses the static form for this reason.
 */
export const ASK_FLAG_ENV_KEY = "EXPO_PUBLIC_ASK_ENABLED";

/** The only two spellings that switch Ask on. Exact match, case-sensitive. */
const ON_VALUES: readonly string[] = ["1", "true"];

/**
 * Whether this build has Ask. When it does not, Ask does not exist in the app:
 * no ✦ pill on Chat home (s04) or Events (s06), no sheet, and the `ask` route
 * redirects to Chat home.
 *
 * **Every Ask surface hangs off this** (owner decision 2026-09-22, #2259). It
 * used not to: the pill rendered and the sheet opened either way, and the sheet
 * then said "Ask isn't switched on for this build yet". A control whose only
 * function is to announce that its feature is off is a placeholder under App
 * Review Guideline 2.1, and no member can switch Ask on, so the pill is hidden
 * rather than disabled. `spec/ui/design-system/README.md` §5 rule 4 ("Disable,
 * don't hide, for recoverable states") names the Ask pill as a case to hide.
 * It is not a rule for every build-time gap. The s03 push primer, gated the
 * same way, has since followed it (#2299, `lib/notifications/primer.ts`).
 * `spec/ui/mobile/navigation.md` § Global entries records the reversal and why
 * the disabled Pay control in `lib/payments/stripe.ts` stays disabled rather
 * than following it.
 */
export function isAskAvailable(): boolean {
  const raw = process.env.EXPO_PUBLIC_ASK_ENABLED;
  return typeof raw === "string" && ON_VALUES.includes(raw.trim());
}

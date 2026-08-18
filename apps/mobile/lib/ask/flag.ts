/**
 * Whether this build is allowed to answer anything with Ask (s17), and — when
 * it is not — the one sentence that says why.
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
 * the value is fixed for a given build — which is exactly what "for this build"
 * means in the copy below. It is not a per-chapter or per-member switch and
 * must never be described to a member as one.
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
 * The read happens inside the functions rather than at module scope, following
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

/** The configured value, or `null` when the variable is absent or blank. */
function configuredFlag(): string | null {
  const raw = process.env.EXPO_PUBLIC_ASK_ENABLED;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Whether Ask may answer.
 *
 * The Ask entry point does **not** hang off this — the ✦ pill renders and the
 * sheet opens either way, and the sheet states the reason. A control that
 * disappears, or one that silently does nothing, is the dead end
 * `spec/ui/design-system/components.md` §5 bans.
 */
export function isAskAvailable(): boolean {
  const value = configuredFlag();
  return value !== null && ON_VALUES.includes(value);
}

/**
 * Why Ask cannot answer, or `null` when it can.
 *
 * §5's rule for a disabled control is that it names its blocker — "A disabled
 * control with no explanation is its own dead end." The two causes get
 * different sentences for the reason `stripeUnavailableReason()` gives: one is
 * "nobody has turned this on yet", the other is "somebody turned it off", and
 * the member's next move differs. Neither sentence promises a date, because
 * this file does not know one.
 */
export function askUnavailableReason(): string | null {
  const value = configuredFlag();

  if (value === null) {
    return "Ask isn't switched on for this build yet. Everything it would quote — bylaws, minutes, announcements — is still readable under More → Documents.";
  }

  if (!ON_VALUES.includes(value)) {
    return "Ask has been switched off for this build. Your bylaws, minutes and announcements are still under More → Documents, and your officers can say when Ask is coming back.";
  }

  return null;
}

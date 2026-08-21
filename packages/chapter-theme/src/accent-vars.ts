/**
 * The accent-role → semantic-token bridge, in its own module so a browser can
 * import it without the engine behind it.
 *
 * `deriveSignetPalette` runs server-side (accent-engine.md §1) and pulls in the
 * vendored Radix generator and `colorjs.io`; a client only ever re-keys an
 * already-generated palette. Importing this through `./signet.js` would put all
 * of that in the web bundle to rename seven strings, so the pure part lives
 * here and `signet.ts` re-exports it for the server callers that want both.
 *
 * It is also the one file in this package a bundler resolves directly, which is
 * why it has no relative *value* imports: the rest of the package carries the
 * `.js` specifiers NodeNext requires of the API build, and those do not resolve
 * against `.ts` sources in a bundler.
 */

import type { SignetPalette } from "./signet.js";

// Re-exported so a bundler consumer gets the input type from the same subpath
// it gets the function from. Type-only, so it costs the bundle nothing.
export type { SignetPalette };

/**
 * The `--signet-accent-*` roles under the semantic names
 * `spec/ui/design-system/foundations.md` §6 gives the accent slot.
 *
 * Two naming systems exist here on purpose. `deriveSignetPalette` emits
 * namespaced `--signet-accent-*` because that is what gets **persisted**, and
 * §6 names the slot by the semantic names components actually consume. This is
 * the bridge, and it is a pure function of an already-generated palette — it
 * never re-runs the generator, so the §8 contrast guarantees carry through
 * unchanged.
 *
 * ## Why this is not what gets stored
 *
 * `chapters.theme_palette` is applied by a client that maps these roles onto
 * `:root` (`apps/web/lib/hooks/use-chapter-theme.ts`). The shape written under
 * a name has to match how the stylesheet stores it: web's legacy stylesheet
 * once defined `--primary` as an **HSL triple** (`30 45% 32%`) that the Tailwind
 * preset wrapped in `hsl(...)`, so a hex written under that name produced the
 * invalid `hsl(#C49A3A)` and every primary-colored surface on the dashboard
 * lost its color at once.
 *
 * That hazard is gone. #1143 moved `--ring` and the whole `--side-*` family to
 * complete colour values read as bare `var(--token)`, and the #920 groundwork
 * moved the rest, so both stylesheets now have exactly one format — every token
 * is a complete colour (`spec/ui/design-system/accent-engine.md` §6).
 *
 * The persisted map stays namespaced anyway, because a namespaced field is
 * additive and cannot collide with anything a surface has not opted into. This
 * mapping is that opt-in: a surface calls it once its own preset reads bare
 * `var(--token)` throughout. `apps/web` took that step in the #920 shell slice
 * and calls this on every chapter resolve; mobile has no stylesheet at all and
 * consumes the namespaced roles directly.
 */
export function signetAccentSemanticVars(
  palette: SignetPalette,
): Record<string, string> {
  return {
    "--primary": palette["--signet-accent-primary"],
    "--primary-hover": palette["--signet-accent-hover"],
    "--primary-foreground": palette["--signet-accent-on-primary"],
    "--ring": palette["--signet-accent-ring"],
    "--accent-subtle": palette["--signet-accent-subtle-bg"],
    "--accent-border": palette["--signet-accent-border"],
    "--accent-text": palette["--signet-accent-text"],
  };
}

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
 * why it has **no relative imports at all**: the rest of the package carries the
 * `.js` specifiers NodeNext requires of the API build, and those do not resolve
 * against `.ts` sources in a bundler.
 *
 * That is why `SignetPalette` lives here rather than beside the generator that
 * produces it. The type is the contract *between* the two — the engine fills it
 * in, this function re-keys it — so a leaf module owning it leaves one edge
 * (`signet.ts` → here) instead of a cycle. `signet.ts` re-exports it, so no
 * consumer has to know where it sits.
 */

/** Every token `deriveSignetPalette` guarantees, as CSS custom properties. */
export interface SignetPalette {
  "--signet-accent-primary": string;
  "--signet-accent-hover": string;
  "--signet-accent-ring": string;
  "--signet-accent-subtle-bg": string;
  "--signet-accent-border": string;
  "--signet-accent-text": string;
  /** The generator's contrast color — text and icons on `accent-primary`. */
  "--signet-accent-on-primary": string;
  /** Translucent counterparts; alpha steps map 1:1 to their solid steps (§2). */
  "--signet-accent-primary-alpha": string;
  "--signet-accent-hover-alpha": string;
  "--signet-accent-ring-alpha": string;
  "--signet-accent-subtle-bg-alpha": string;
  "--signet-accent-border-alpha": string;
  "--signet-accent-text-alpha": string;
}

/**
 * The seven roles {@link signetAccentSemanticVars} reads. The alpha family is
 * not bridged, so a palette needs only these to be painted.
 */
export const SIGNET_SEMANTIC_ROLES = [
  "--signet-accent-primary",
  "--signet-accent-hover",
  "--signet-accent-ring",
  "--signet-accent-subtle-bg",
  "--signet-accent-border",
  "--signet-accent-text",
  "--signet-accent-on-primary",
] as const;

/** The part of a {@link SignetPalette} the bridge reads. */
export type SignetSemanticRoles = Pick<
  SignetPalette,
  (typeof SIGNET_SEMANTIC_ROLES)[number]
>;

/**
 * Whether a stored palette carries every role the bridge reads.
 *
 * `chapters.theme_palette` is a `jsonb` blob, and the contract types it
 * `{ [key: string]: unknown }`, so a client has to check it before handing it
 * over. All-or-nothing: a row persisted before the Signet keys existed (until
 * the #1165 sweep reaches it) fails, and half a map is worse than none. One
 * chapter's primary beside the house ring is not a consistent palette.
 */
export function hasSignetSemanticRoles(
  palette: object,
): palette is SignetSemanticRoles {
  return SIGNET_SEMANTIC_ROLES.every(
    (key) => typeof Reflect.get(palette, key) === "string",
  );
}

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
 * That hazard is gone. #1143 moved `--ring` and the legacy sidebar family to
 * complete colour values read as bare `var(--token)`, and the #920 groundwork
 * moved the rest, so both stylesheets now have exactly one format — every token
 * is a complete colour (`spec/ui/design-system/accent-engine.md` §6). That
 * sidebar family has since been deleted outright; only `--ring` survives, and
 * it is written from `--signet-accent-ring` by the mapping below.
 *
 * The persisted map stays namespaced anyway, because a namespaced field is
 * additive and cannot collide with anything a surface has not opted into. This
 * mapping is that opt-in: a surface calls it once its own preset reads bare
 * `var(--token)` throughout. `apps/web` took that step in the #920 shell slice
 * and calls this on every chapter resolve; mobile has no stylesheet at all and
 * consumes the namespaced roles directly.
 */
export function signetAccentSemanticVars(
  palette: SignetSemanticRoles,
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

import type { CSSProperties } from "react";

/**
 * How a role-colored name is painted inside a row that hovers to
 * `--card-hover` (#4387).
 *
 * At full strength Rose and Violet sit a hair under AA on `--card-hover` (the
 * figures, and why the stored palette can't be re-pitched, are in
 * `ROLE_COLOR_PALETTE`'s doc in `@repo/validation`). So the hovered row lifts
 * the name instead: it mixes {@link ROLE_NAME_HOVER_LIFT} of white into the
 * role color while the row is hovered. At rest the name is the exact palette
 * value. Only web hovers, so mobile is untouched.
 *
 * The row carries `group/row`; the name carries {@link ROLE_NAME_CLASS} and
 * {@link roleNameStyle}. `role-colors-contrast.spec.ts` reads the mix out of
 * the class string and measures every swatch at it.
 */
export const ROLE_NAME_HOVER_LIFT = 0.1;

/** Tailwind needs the literal: keep the 90% in step with the lift above. */
export const ROLE_NAME_CLASS =
  "text-(--role-name) group-hover/row:text-[color-mix(in_srgb,var(--role-name)_90%,white)]";

/** The inline custom property {@link ROLE_NAME_CLASS} paints from. */
export function roleNameStyle(hex: string): CSSProperties {
  return { "--role-name": hex } as CSSProperties;
}

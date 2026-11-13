import type { CSSProperties } from "react";

/**
 * How a role-colored name is painted inside a row that hovers to
 * `--card-hover` (#4387).
 *
 * `--card-hover` has to sit a visible step above `--popover`, and at that step
 * Rose and Violet read 4.49:1 and 4.42:1, a hair under AA. The stored palette
 * value can't move (the API stores it and shipped mobile builds paint only
 * exact palette values), so the hovered row lifts the name instead: it mixes
 * {@link ROLE_NAME_HOVER_LIFT} of white into the role color while the row is
 * hovered. At 10% every swatch clears 4.9:1 on `--card-hover`; at rest the
 * name is the exact palette value. Only web hovers, so mobile is untouched.
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

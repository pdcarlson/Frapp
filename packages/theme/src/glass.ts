/**
 * The glass layer: one recipe for the chrome that floats over content on both
 * clients (owner pick 2026-11-05, "Floating bar, no glow";
 * `spec/ui/design-system/foundations.md` § 15. Glass).
 *
 * Glass is chrome only: the mobile tab bar, back capsules, the floating create
 * button, and the blur under a sheet or dialog scrim. Never a sheet, a card or
 * an input, which stay solid steps on the ladder so their text keeps its
 * measured contrast.
 *
 * The fill is the ladder's nav step (`surface1`) at partial alpha, so it moves
 * with the ladder rather than carrying a hex of its own. Elevation stays
 * luminance: the edge and the specular are light, never a drop shadow
 * (foundations §10).
 */
export const signetGlass = {
  /** Alpha of `surface1` over the blur. Low enough to show colour through; the blur under it does the rest of the work of keeping a label legible. */
  fillAlpha: 0.56,
  /** Fill alpha where nothing blurs behind (Android before the blur target lands): near-solid, so text never sits on raw content. */
  unblurredFillAlpha: 0.92,
  /** Backdrop blur radius in px (web `backdrop-filter`, iOS before 26 via `expo-blur` intensity). */
  blur: 26,
  /** Backdrop saturation, so colour under the glass reads as colour rather than mud. */
  saturate: 1.75,
  /** The 1px edge: white at 10%, a step brighter than the 8% hairline so the shape reads over any content. */
  edge: "rgba(255,255,255,0.10)",
  /** White at the top of the specular sheen, fading to nothing by `specularStop`. */
  specular: 0.07,
  specularStop: 0.46,
  /** Blur under a sheet or dialog scrim, in px, beneath the existing 55% black. */
  scrimBlur: 6,
} as const;

/** `#RRGGBB` at `alpha`, for the glass fill over a ladder step. */
export function glassFill(surfaceHex: string, alpha: number): string {
  const value = surfaceHex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * The four control points of a motion-scale curve (`@repo/theme`'s
 * `motion.easing`, written as CSS `cubic-bezier(x1, y1, x2, y2)` so the web
 * reads it as is), for Reanimated's `Easing.bezier`. Reading the token, not
 * copying its numbers, keeps a phone animation on the scale when the
 * provisional values are retuned (`foundations.md` §11).
 *
 * A value that isn't a cubic-bezier throws: `motion-easing.spec.ts` parses
 * every curve on the scale, so a token that stops being one fails there.
 */
export function cubicBezierPoints(
  css: string,
): [number, number, number, number] {
  const match =
    /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(
      css.trim(),
    );
  if (!match) throw new Error(`Not a cubic-bezier curve: ${css}`);
  const points = match.slice(1).map(Number);
  if (points.some((point) => Number.isNaN(point))) {
    throw new Error(`Not a cubic-bezier curve: ${css}`);
  }
  return points as [number, number, number, number];
}

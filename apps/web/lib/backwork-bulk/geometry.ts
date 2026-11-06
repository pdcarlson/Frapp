/**
 * Redaction geometry for backwork bulk upload (#3499).
 *
 * Every box is in **page units at scale 1, origin top-left**: the coordinate
 * space of a pdf.js viewport built with `{ scale: 1 }`, so it already includes
 * the page's own rotation. The editor converts pointer positions into this
 * space and the flattener scales out of it, so a box drawn at one zoom burns
 * in at the same spot at any render resolution.
 */
export type Box = { x: number; y: number; width: number; height: number };

/** Boxes keyed by 1-based page number, the way pdf.js numbers pages. */
export type BoxesByPage = Record<number, Box[]>;

/** Smallest box the editor keeps; a click without a drag draws nothing. */
export const MIN_BOX_SIZE = 4;

/** The box spanned by two corners, in either drag direction. */
export function boxFromCorners(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Keeps a box on the page, shrinking it where it hangs off an edge. */
export function clampBox(box: Box, pageWidth: number, pageHeight: number): Box {
  const x = Math.min(Math.max(box.x, 0), pageWidth);
  const y = Math.min(Math.max(box.y, 0), pageHeight);
  const right = Math.min(Math.max(box.x + box.width, 0), pageWidth);
  const bottom = Math.min(Math.max(box.y + box.height, 0), pageHeight);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * True when the boxes overlap or touch once `a` is grown by `margin` on every
 * side. Touching counts: the text filter treats a word that grazes a box as
 * covered, because a partial overlap is exactly where a name leaks.
 */
export function boxesIntersect(a: Box, b: Box, margin = 0): boolean {
  return (
    a.x - margin <= b.x + b.width &&
    a.x + a.width + margin >= b.x &&
    a.y - margin <= b.y + b.height &&
    a.y + a.height + margin >= b.y
  );
}

export function countBoxes(boxes: BoxesByPage): number {
  return Object.values(boxes).reduce((sum, list) => sum + list.length, 0);
}

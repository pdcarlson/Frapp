import { boxesIntersect, type Box } from "./geometry";

/**
 * The searchable text kept on a flattened backwork page (#3499).
 *
 * Flattening redraws every page as an image, which is what makes a redaction
 * real, and it also throws away the text a reader could search or copy. This
 * module puts the text back, minus every word a redaction box touches: the
 * source PDF's own text items are placed on the page, any item that touches a
 * box is dropped **whole** (never cut at the box edge, so half a name cannot
 * survive), and what is left is drawn back as invisible text over the image.
 *
 * Items are the `TextItem`s pdf.js's `getTextContent()` returns. Their
 * `transform` is in PDF user space, so the caller passes the viewport's point
 * converter (`viewport.convertToViewportPoint`) to bring them into the boxes'
 * space (`geometry.ts`).
 */
export type RawTextItem = {
  str: string;
  /** `[a, b, c, d, e, f]`: text direction, up vector, and baseline origin. */
  transform: number[];
  /** Advance width in PDF user space. */
  width: number;
  /** Font height in PDF user space. */
  height: number;
};

export type PlacedText = {
  str: string;
  /** Conservative glyph bounds in viewport space, descenders included. */
  rect: Box;
  /**
   * Set only for horizontal, left-to-right text on an unrotated page: the one
   * case the redraw handles. Everything else still counts for the box filter
   * but is not redrawn, so the page simply has less searchable text.
   */
  upright?: { x: number; baseline: number; size: number; width: number };
};

type ToViewport = (x: number, y: number) => number[];

/** How far below the baseline a glyph can reach, as a share of font height. */
const DESCENT = 0.3;
/** How far above the baseline, as a share of font height. */
const ASCENT = 1.05;

export function placeTextItems(
  items: readonly RawTextItem[],
  toViewport: ToViewport,
  pageRotation: number,
): PlacedText[] {
  const placed: PlacedText[] = [];
  for (const item of items) {
    if (!item.str || item.str.trim().length === 0) continue;
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
    const dirLen = Math.hypot(a, b);
    const upLen = Math.hypot(c, d);
    if (dirLen === 0 || upLen === 0) continue;
    const height = item.height > 0 ? item.height : upLen;
    const dir = [a / dirLen, b / dirLen];
    const up = [c / upLen, d / upLen];

    const corner = (along: number, rise: number) =>
      toViewport(
        e + dir[0]! * along + up[0]! * rise,
        f + dir[1]! * along + up[1]! * rise,
      );
    const corners = [
      corner(0, -DESCENT * height),
      corner(item.width, -DESCENT * height),
      corner(0, ASCENT * height),
      corner(item.width, ASCENT * height),
    ];
    const xs = corners.map((p) => p[0]!);
    const ys = corners.map((p) => p[1]!);
    const rect: Box = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };

    const isUpright =
      pageRotation % 360 === 0 && b === 0 && c === 0 && a > 0 && d > 0;
    const entry: PlacedText = { str: item.str, rect };
    if (isUpright) {
      const origin = toViewport(e, f);
      entry.upright = {
        x: origin[0]!,
        baseline: origin[1]!,
        size: height,
        width: item.width,
      };
    }
    placed.push(entry);
  }
  return placed;
}

/** Margin, in page units, a word must keep from every box to survive. */
export const TEXT_BOX_MARGIN = 2;

export function textOutsideBoxes(
  placed: readonly PlacedText[],
  boxes: readonly Box[],
  margin = TEXT_BOX_MARGIN,
): PlacedText[] {
  if (boxes.length === 0) return [...placed];
  return placed.filter(
    (item) => !boxes.some((box) => boxesIntersect(item.rect, box, margin)),
  );
}

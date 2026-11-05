import type { Box } from "./geometry";
import {
  placeTextItems,
  textOutsideBoxes,
  type PlacedText,
  type RawTextItem,
} from "./text-layer";

/**
 * The per-page steps of flattening (#3499) that don't need a browser, so the
 * specs run the same code `flattenPdf` ships: which text survives into the
 * invisible layer, and where the boxes are burned.
 */

/** The pdf.js page and viewport surface these steps read. */
export type TextPage = {
  getTextContent: () => Promise<{ items: readonly object[] }>;
};
export type BaseViewport = {
  rotation: number;
  convertToViewportPoint: (x: number, y: number) => number[];
};

/**
 * Text the person can't see is never carried into the text layer. The check
 * runs on the rendered page before the boxes go on: a word whose own area is
 * one flat colour isn't visible there, whether an earlier tool drew a black
 * rectangle over it, it is white on white, or a stuck-on image covers it.
 * Boxing what you see then covers everything that reaches the upload.
 *
 * A pdf.js text item is often a whole run ("Student: Jane Doe"), and a bar
 * may hide only part of it, so an upright item is checked one character cell
 * at a time and kept only if every non-blank cell shows ink. A cell that
 * misses its glyph only costs that run its searchability, never its privacy.
 * Rotated items are checked as one area.
 */
export type IsVisible = (rect: Box) => boolean;

export async function pageTextLayer(
  page: TextPage,
  base: BaseViewport,
  boxes: readonly Box[],
  isVisible?: IsVisible,
): Promise<PlacedText[]> {
  const content = await page.getTextContent();
  const items = content.items.filter(
    (item): item is RawTextItem => "str" in item && "transform" in item,
  );
  const placed = placeTextItems(
    items,
    (x, y) => base.convertToViewportPoint(x, y) as [number, number],
    base.rotation,
  );
  const outside = textOutsideBoxes(placed, boxes);
  return isVisible
    ? outside.filter((item) => inkCells(item).every(isVisible))
    : outside;
}

/** The areas whose ink decides whether a text item is visible. */
export function inkCells(item: PlacedText): Box[] {
  const chars = Array.from(item.str);
  if (!item.upright || chars.length <= 1) return [inkSampleRect(item.rect)];
  const cell = item.rect.width / chars.length;
  const cells: Box[] = [];
  chars.forEach((char, index) => {
    if (char.trim() === "") return;
    cells.push(
      inkSampleRect({ ...item.rect, x: item.rect.x + index * cell, width: cell }),
    );
  });
  return cells.length > 0 ? cells : [inkSampleRect(item.rect)];
}

/**
 * The part of a text item's box to look for ink in. The box is generous (it
 * runs from below the descenders to above the tallest accent), so a bar that
 * hides the glyphs often leaves a sliver of paper at its edge; sampling only
 * the middle of the line keeps that sliver from reading as visible text.
 */
export function inkSampleRect(rect: Box): Box {
  const insetY = rect.height * 0.25;
  const insetX = Math.min(rect.width * 0.05, 2);
  return {
    x: rect.x + insetX,
    y: rect.y + insetY,
    width: Math.max(rect.width - insetX * 2, 0),
    height: Math.max(rect.height - insetY * 2, 0),
  };
}

/** Burns the boxes (page units) into a canvas rendered at `scale`. */
export function burnBoxes(
  ctx: { fillStyle: unknown; fillRect: (x: number, y: number, w: number, h: number) => void },
  boxes: readonly Box[],
  scale: number,
): void {
  ctx.fillStyle = "#000";
  for (const box of boxes) {
    // Rounded outward and one pixel over, so antialiasing never leaves a
    // readable edge.
    ctx.fillRect(
      Math.floor(box.x * scale),
      Math.floor(box.y * scale),
      Math.ceil(box.width * scale) + 1,
      Math.ceil(box.height * scale) + 1,
    );
  }
}

/** The rendered page canvas, as much of it as the redaction step touches. */
export type RenderedPage = {
  width: number;
  height: number;
  ctx: {
    fillStyle: unknown;
    fillRect: (x: number, y: number, w: number, h: number) => void;
    getImageData: (x: number, y: number, w: number, h: number) => { data: ArrayLike<number> };
  };
};

/**
 * Redacts one page that `flattenPdf` has rendered at `scale`: reads the text
 * layer off the pixels as they are, then burns the boxes in. The order
 * matters. Read after the burn, every boxed word would look hidden anyway,
 * and a box missing from the text filter would go unnoticed.
 */
export async function redactRenderedPage(
  page: TextPage,
  base: BaseViewport,
  boxes: readonly Box[],
  scale: number,
  canvas: RenderedPage,
  keepText = true,
): Promise<PlacedText[]> {
  const text = keepText
    ? await pageTextLayer(page, base, boxes, (rect) => {
        // Only the part of the area that is on the page: text placed off
        // the page has nothing visible there, so it is dropped.
        const left = Math.max(0, Math.floor(rect.x * scale));
        const top = Math.max(0, Math.floor(rect.y * scale));
        const right = Math.min(canvas.width, Math.ceil((rect.x + rect.width) * scale));
        const bottom = Math.min(canvas.height, Math.ceil((rect.y + rect.height) * scale));
        if (right <= left || bottom <= top) return false;
        return hasInk(canvas.ctx.getImageData(left, top, right - left, bottom - top).data);
      })
    : [];
  burnBoxes(canvas.ctx, boxes, scale);
  return text;
}

/** Share of a region's pixels that must stand apart from its usual colour. */
const MIN_INK = 0.01;
/** How far, in luminance (0 to 255), a pixel must stand apart to count. */
const INK_CONTRAST = 40;

/**
 * Whether an RGBA region has visible marks: enough pixels far enough from
 * the region's median luminance. Glyphs on paper pass easily; a flat fill
 * does not.
 */
export function hasInk(rgba: ArrayLike<number>): boolean {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return false;
  const histogram = new Uint32Array(256);
  const lum = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    const value = Math.round(
      0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!,
    );
    lum[i] = value;
    histogram[value]! += 1;
  }
  let median = 0;
  for (let seen = 0; median < 256; median += 1) {
    seen += histogram[median]!;
    if (seen * 2 >= pixels) break;
  }
  let marked = 0;
  for (let i = 0; i < pixels; i += 1) {
    if (Math.abs(lum[i]! - median) >= INK_CONTRAST) marked += 1;
  }
  return marked / pixels >= MIN_INK;
}

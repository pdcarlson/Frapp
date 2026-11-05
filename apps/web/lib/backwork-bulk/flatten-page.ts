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
  return isVisible ? outside.filter((item) => isVisible(item.rect)) : outside;
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

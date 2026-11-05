import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import type { PlacedText } from "./text-layer";

/**
 * One flattened page: the rendered image with redaction boxes already burned
 * in, and the text that survived the box filter (`text-layer.ts`).
 * `width`/`height` are the page size in points (viewport space at scale 1).
 */
export type FlatPage = {
  width: number;
  height: number;
  jpeg: Uint8Array;
  text: readonly PlacedText[];
};

/**
 * Builds the PDF that is stored for a redacted backwork file (#3499).
 *
 * The output is a brand-new document: each page is one JPEG plus invisible
 * text, and nothing from the source survives except what the caller passes
 * in. No source objects, fonts, annotations, form fields, attachments,
 * incremental-save history, or Info metadata are copied, because none of it
 * is read. `updateMetadata: false` keeps pdf-lib from writing a producer or
 * timestamps, which also makes the output deterministic: the same file with
 * the same boxes produces the same bytes, so the library's `file_hash`
 * duplicate check still catches a re-upload.
 */
export async function assembleFlatPdf(
  pages: readonly FlatPage[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const needsFont = pages.some((page) =>
    page.text.some((item) => item.upright),
  );
  const font = needsFont ? await doc.embedFont(StandardFonts.Helvetica) : null;
  const supported = font ? new Set(font.getCharacterSet()) : null;

  for (const flat of pages) {
    const page = doc.addPage([flat.width, flat.height]);
    const image = await doc.embedJpg(flat.jpeg);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: flat.width,
      height: flat.height,
    });
    if (!font || !supported) continue;
    for (const item of flat.text) {
      if (!item.upright) continue;
      const text = encodable(item.str, supported);
      if (!text.trim()) continue;
      page.drawText(text, {
        x: item.upright.x,
        y: flat.height - item.upright.baseline,
        size: fittedSize(font, text, item.upright.size, item.upright.width),
        font,
        opacity: 0,
      });
    }
  }
  return doc.save({ useObjectStreams: false });
}

/**
 * Helvetica (WinAnsi) can't encode every character pdf.js extracts, and
 * pdf-lib throws on one it can't. A character outside the set becomes a space,
 * which keeps word boundaries for search.
 */
function encodable(str: string, supported: ReadonlySet<number>): string {
  let out = "";
  for (const ch of str) {
    const code = ch.codePointAt(0);
    out += code !== undefined && supported.has(code) ? ch : " ";
  }
  return out;
}

/**
 * Scales the invisible text so its width roughly matches the source word,
 * which keeps a viewer's selection highlight near the visible glyphs. Bounded
 * so a mismeasured item can't turn into giant or microscopic text.
 */
function fittedSize(
  font: PDFFont,
  text: string,
  size: number,
  targetWidth: number,
): number {
  const natural = font.widthOfTextAtSize(text, size);
  if (natural <= 0 || targetWidth <= 0) return size;
  const fitted = size * (targetWidth / natural);
  return Math.min(Math.max(fitted, size * 0.5), size * 1.5);
}

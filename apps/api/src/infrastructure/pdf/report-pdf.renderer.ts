import { Injectable, Logger } from '@nestjs/common';
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import type {
  IReportPdfRenderer,
  ReportPdfColumn,
  ReportPdfDocument,
} from '../../domain/adapters/pdf.interface';

/** Landscape US Letter — 5-column reports (attendance, service) need the width. */
const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;

const MARGIN = 40;
const HEADER_BAND = 88;
const FOOTER_BAND = 30;
const LOGO_BOX = 46;

const HEAD_ROW_HEIGHT = 20;
const ROW_HEIGHT = 17;
const CELL_PAD = 6;
const BODY_SIZE = 9;
const HEAD_SIZE = 9;

const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.84, 0.86, 0.89);
const HEAD_FILL = rgb(0.93, 0.94, 0.96);
const ZEBRA_FILL = rgb(0.969, 0.973, 0.98);

/**
 * Code points outside Latin-1 that WinAnsi (cp1252) still encodes. The standard
 * PDF fonts are WinAnsi-only, and pdf-lib *throws* on a code point it cannot
 * encode — so every string is filtered through `toWinAnsi` before it reaches
 * `drawText`. A member named "Łukasz" or "李" must degrade to readable ASCII,
 * never take down the whole export.
 */
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function isWinAnsiEncodable(codePoint: number): boolean {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true;
  return WIN_ANSI_EXTRAS.has(codePoint);
}

/**
 * Latin letters whose glyph is a *stroked* or otherwise modified base rather
 * than a base plus a combining mark. Unicode gives these no canonical
 * decomposition, so NFKD cannot recover the base letter and they would fall
 * through to "?" — turning a real Polish surname into "?ukasz Wróblewski".
 */
const CHAR_FOLD: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  Ŧ: 'T',
  ŧ: 't',
  Ŋ: 'N',
  ŋ: 'n',
  Ə: 'E',
  ə: 'e',
  ı: 'i',
  İ: 'I',
  Ƶ: 'Z',
  ƶ: 'z',
  // FRACTION SLASH. NFKD expands "⅓" to "1" + U+2044 + "3"; dropping the slash
  // would weld the digits into "13", so "1⅓ hrs" of service would print as
  // "113 hrs". A fabricated number is far worse than a degraded glyph.
  '⁄': '/',
};

/** Zero-width: combining marks with no precomposed form, and format characters. */
const ZERO_WIDTH = /[\p{M}\p{Cf}]/u;

/** Any Unicode space, including LINE and PARAGRAPH SEPARATOR. */
const UNICODE_SPACE = /[\p{Zs}\p{Zl}\p{Zp}]/u;

/**
 * Fold one character into WinAnsi-safe text, recursing once through its NFKD
 * expansion. Returns '' for characters that should vanish.
 */
function foldChar(char: string, expanded = false): string {
  // Zero-width first, *before* the encodable check: U+00AD SOFT HYPHEN is a
  // format character that cp1252 happens to encode, and pdf-lib maps it to the
  // same glyph as "-". Letting it through prints a visible hyphen where the
  // input had nothing — so "Anne<SHY>Marie" would render "Anne-Marie" and
  // become indistinguishable from a genuinely different member of that name.
  if (ZERO_WIDTH.test(char)) return '';

  const codePoint = char.codePointAt(0) ?? 0;
  if (isWinAnsiEncodable(codePoint)) return char;

  const mapped = CHAR_FOLD[char];
  if (mapped) return mapped;

  // LINE/PARAGRAPH SEPARATOR and exotic spaces collapse like a newline does —
  // every cell is one line. Reached only when the space is not itself
  // encodable, so U+00A0 keeps its own glyph.
  if (UNICODE_SPACE.test(char)) return ' ';

  if (!expanded) {
    const decomposed = char.normalize('NFKD');
    if (decomposed !== char) {
      const folded = [...decomposed]
        .map((part) => foldChar(part, true))
        .join('');
      // A vulgar fraction sits tight against a preceding integer ("1⅓ hrs"),
      // and its expansion is bare digits and a slash — "11/3" reads as
      // eleven-thirds. A leading space restores the mixed number; a stray
      // leading space elsewhere is collapsed or trimmed below.
      return decomposed.includes('⁄') ? ` ${folded}` : folded;
    }
  }
  return '?';
}

/**
 * Make `value` safe for a WinAnsi standard font.
 *
 * The standard PDF fonts are WinAnsi-only and pdf-lib *throws* on a code point
 * it cannot encode, so every string reaching `drawText` passes through here.
 *
 * Encodable characters pass through untouched, so "José" keeps its accent.
 * Anything else is folded: modified Latin letters map to their base via
 * {@link CHAR_FOLD}, and the rest are decomposed (NFKD) and stripped of
 * combining marks, which recovers a base letter for most Latin extensions
 * ("ā" → "a"). Zero-width characters vanish; what survives none of that becomes
 * "?". Control characters and newlines collapse to single spaces because every
 * cell is one line.
 *
 * The guiding rule for every branch: degrading a character is fine, but a
 * character that was invisible must never become visible, and a fold must never
 * fabricate a different value.
 */
export function toWinAnsi(value: string): string {
  let out = '';
  // Compose first. Text arriving in NFD (macOS/iOS pasteboard and filesystem
  // sources commonly are) presents "é" as "e" + U+0301: the base letter would
  // pass through encodable and the bare combining mark would then hit the
  // fallback, yielding "Jose?" for a name cp1252 can represent exactly.
  for (const char of value.normalize('NFC')) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) {
      out += ' ';
      continue;
    }
    // DEL and the C1 block join the C0 controls in being dropped outright.
    if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) continue;
    out += foldChar(char);
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Render any report cell value as a single line of text. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((entry) => formatCell(entry))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    // Points reports carry `breakdown_by_category` as a category→total object;
    // "ATTENDANCE: 12, SERVICE: 4" reads far better than raw JSON.
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${formatCell(entry)}`)
      .join(', ');
  }
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  // Functions and symbols have no meaningful cell rendering; blank beats
  // printing source text or "[object Object]" into an officer's report.
  return '';
}

/** Shrink `text` with an ellipsis until it fits `maxWidth`. */
function fitText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return '';
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, mid).trimEnd()}…`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low <= 0 ? '' : `${text.slice(0, low).trimEnd()}…`;
}

/** Distribute usable width across columns by weight. */
function columnWidths(columns: ReportPdfColumn[], usable: number): number[] {
  const weights = columns.map((column) => column.weight ?? 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights.map((weight) => (weight / total) * usable);
}

@Injectable()
export class ReportPdfRenderer implements IReportPdfRenderer {
  private readonly logger = new Logger(ReportPdfRenderer.name);

  async render(document: ReportPdfDocument): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(toWinAnsi(document.title));
    pdf.setProducer('Frapp');
    pdf.setCreator('Frapp');

    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const logo = await this.embedLogo(pdf, document);

    const usableWidth = PAGE_WIDTH - MARGIN * 2;
    const widths = columnWidths(document.columns, usableWidth);
    const tableTop = PAGE_HEIGHT - MARGIN - HEADER_BAND;
    const tableFloor = MARGIN + FOOTER_BAND;
    const rowsPerPage = Math.max(
      1,
      Math.floor((tableTop - HEAD_ROW_HEIGHT - tableFloor) / ROW_HEIGHT),
    );
    const pageCount = Math.max(
      1,
      Math.ceil(document.rows.length / rowsPerPage),
    );

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.drawHeader(page, document, { regular, bold }, logo);
      this.drawFooter(page, document, regular, pageIndex + 1, pageCount);

      const slice = document.rows.slice(
        pageIndex * rowsPerPage,
        (pageIndex + 1) * rowsPerPage,
      );
      this.drawTable(page, document.columns, widths, slice, {
        regular,
        bold,
        top: tableTop,
        startIndex: pageIndex * rowsPerPage,
      });
    }

    return pdf.save();
  }

  /**
   * Embed the chapter logo, tolerating anything that is not a usable PNG/JPEG.
   * Sniffing magic bytes beats trusting the stored content type: the logo is
   * uploaded through a signed URL where the client picks its own header.
   */
  private async embedLogo(
    pdf: PDFDocument,
    document: ReportPdfDocument,
  ): Promise<PDFImage | null> {
    const logo = document.branding.logo;
    if (!logo || logo.bytes.length === 0) return null;
    const bytes = logo.bytes;
    const isPng =
      bytes.length > 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47;
    const isJpg =
      bytes.length > 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
    try {
      if (isPng) return await pdf.embedPng(bytes);
      if (isJpg) return await pdf.embedJpg(bytes);
      this.logger.warn(
        'Chapter logo is neither PNG nor JPEG; rendering report without it.',
      );
      return null;
    } catch (error) {
      this.logger.warn(
        `Chapter logo could not be embedded, rendering report without it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private drawHeader(
    page: PDFPage,
    document: ReportPdfDocument,
    fonts: { regular: PDFFont; bold: PDFFont },
    logo: PDFImage | null,
  ): void {
    const top = PAGE_HEIGHT - MARGIN;
    let textLeft = MARGIN;

    if (logo) {
      const scale = Math.min(LOGO_BOX / logo.width, LOGO_BOX / logo.height);
      const width = logo.width * scale;
      const height = logo.height * scale;
      page.drawImage(logo, {
        x: MARGIN,
        // Centre the logo inside its box so wide and tall marks both sit level.
        y: top - LOGO_BOX + (LOGO_BOX - height) / 2,
        width,
        height,
      });
      textLeft = MARGIN + LOGO_BOX + 14;
    }

    const textWidth = PAGE_WIDTH - MARGIN - textLeft;
    page.drawText(
      fitText(
        toWinAnsi(document.branding.chapterName),
        fonts.bold,
        15,
        textWidth,
      ),
      { x: textLeft, y: top - 13, size: 15, font: fonts.bold, color: INK },
    );
    page.drawText(
      fitText(
        toWinAnsi(document.branding.university),
        fonts.regular,
        9.5,
        textWidth,
      ),
      {
        x: textLeft,
        y: top - 26,
        size: 9.5,
        font: fonts.regular,
        color: MUTED,
      },
    );
    page.drawText(
      fitText(toWinAnsi(document.title), fonts.bold, 12, textWidth),
      { x: textLeft, y: top - 45, size: 12, font: fonts.bold, color: INK },
    );
    if (document.subtitle) {
      page.drawText(
        fitText(toWinAnsi(document.subtitle), fonts.regular, 9, textWidth),
        {
          x: textLeft,
          y: top - 58,
          size: 9,
          font: fonts.regular,
          color: MUTED,
        },
      );
    }

    page.drawRectangle({
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - HEADER_BAND + 12,
      width: PAGE_WIDTH - MARGIN * 2,
      height: 0.75,
      color: RULE,
    });
  }

  private drawFooter(
    page: PDFPage,
    document: ReportPdfDocument,
    font: PDFFont,
    pageNumber: number,
    pageCount: number,
  ): void {
    const y = MARGIN - 8;
    page.drawRectangle({
      x: MARGIN,
      y: MARGIN + 8,
      width: PAGE_WIDTH - MARGIN * 2,
      height: 0.75,
      color: RULE,
    });
    page.drawText(toWinAnsi(`Generated by Frapp - ${document.generatedAt}`), {
      x: MARGIN,
      y,
      size: 8,
      font,
      color: MUTED,
    });
    const label = toWinAnsi(`Page ${pageNumber} of ${pageCount}`);
    page.drawText(label, {
      x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(label, 8),
      y,
      size: 8,
      font,
      color: MUTED,
    });
  }

  private drawTable(
    page: PDFPage,
    columns: ReportPdfColumn[],
    widths: number[],
    rows: Record<string, unknown>[],
    layout: {
      regular: PDFFont;
      bold: PDFFont;
      top: number;
      startIndex: number;
    },
  ): void {
    const { regular, bold, top } = layout;

    page.drawRectangle({
      x: MARGIN,
      y: top - HEAD_ROW_HEIGHT,
      width: PAGE_WIDTH - MARGIN * 2,
      height: HEAD_ROW_HEIGHT,
      color: HEAD_FILL,
    });

    let x = MARGIN;
    columns.forEach((column, index) => {
      const width = widths[index] ?? 0;
      page.drawText(
        fitText(
          toWinAnsi(column.header),
          bold,
          HEAD_SIZE,
          width - CELL_PAD * 2,
        ),
        {
          x: x + CELL_PAD,
          y: top - HEAD_ROW_HEIGHT + 6.5,
          size: HEAD_SIZE,
          font: bold,
          color: INK,
        },
      );
      x += width;
    });

    if (rows.length === 0) {
      page.drawText('No rows matched these filters.', {
        x: MARGIN + CELL_PAD,
        y: top - HEAD_ROW_HEIGHT - ROW_HEIGHT + 5,
        size: BODY_SIZE,
        font: regular,
        color: MUTED,
      });
      return;
    }

    rows.forEach((row, rowIndex) => {
      const rowTop = top - HEAD_ROW_HEIGHT - rowIndex * ROW_HEIGHT;
      // Zebra by absolute row index so shading stays continuous across pages.
      if ((layout.startIndex + rowIndex) % 2 === 1) {
        page.drawRectangle({
          x: MARGIN,
          y: rowTop - ROW_HEIGHT,
          width: PAGE_WIDTH - MARGIN * 2,
          height: ROW_HEIGHT,
          color: ZEBRA_FILL,
        });
      }

      let cellX = MARGIN;
      columns.forEach((column, index) => {
        const width = widths[index] ?? 0;
        const text = fitText(
          toWinAnsi(formatCell(row[column.key])),
          regular,
          BODY_SIZE,
          width - CELL_PAD * 2,
        );
        if (text) {
          page.drawText(text, {
            x: cellX + CELL_PAD,
            y: rowTop - ROW_HEIGHT + 5.5,
            size: BODY_SIZE,
            font: regular,
            color: INK,
          });
        }
        cellX += width;
      });
    });
  }
}

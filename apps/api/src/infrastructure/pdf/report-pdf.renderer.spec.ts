import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import {
  ReportPdfRenderer,
  formatCell,
  toWinAnsi,
} from './report-pdf.renderer';
import type { ReportPdfDocument } from '../../domain/adapters/pdf.interface';

const COLUMNS = [
  { key: 'member_name', header: 'Member Name' },
  { key: 'status', header: 'Status' },
];

/**
 * How many image XObjects the first page references. Entries are PDFRefs, so
 * each is resolved through the document context before its Subtype is read.
 */
function imageCount(pdf: PDFDocument): number {
  const resources = pdf.getPage(0).node.Resources();
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xobjects) return 0;
  return xobjects.entries().filter(([, value]) => {
    const resolved = pdf.context.lookup(value);
    return (
      resolved instanceof PDFRawStream &&
      resolved.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
    );
  }).length;
}

function doc(overrides: Partial<ReportPdfDocument> = {}): ReportPdfDocument {
  return {
    title: 'Attendance Report',
    subtitle: '2026-01-01 – 2026-05-31 · All events',
    generatedAt: '2026-08-05 13:40:00 UTC',
    columns: COLUMNS,
    rows: [{ member_name: 'John Doe', status: 'PRESENT' }],
    branding: {
      chapterName: 'Tau Nu',
      university: 'Rensselaer Polytechnic Institute',
      logo: null,
    },
    ...overrides,
  };
}

describe('toWinAnsi', () => {
  it('passes through characters the standard fonts can encode', () => {
    expect(toWinAnsi('José Núñez')).toBe('José Núñez');
    expect(toWinAnsi('quote " and dash –')).toBe('quote " and dash –');
  });

  it('folds Latin extensions down to an encodable base letter', () => {
    // "ā" is outside cp1252 but decomposes to "a" + a combining macron.
    expect(toWinAnsi('Kaimana Āhia')).toBe('Kaimana Ahia');
  });

  it('composes decomposed (NFD) input before encoding', () => {
    // macOS/iOS-sourced text often arrives decomposed; without an NFC pass the
    // bare combining mark becomes "?" and "José Muñoz" renders "Jose? Mun?oz".
    expect(toWinAnsi('José Muñoz'.normalize('NFD'))).toBe('José Muñoz');
    expect(toWinAnsi('á')).toBe('á');
  });

  it('drops zero-width format characters instead of substituting "?"', () => {
    // A BOM surviving a UTF-8-with-BOM roster import must not print a literal
    // "?" in front of the first member's name.
    expect(toWinAnsi('\uFEFFAaron Smith')).toBe('Aaron Smith');
    expect(toWinAnsi('John\u200BDoe')).toBe('JohnDoe');
    expect(toWinAnsi('Sara\u200Eh')).toBe('Sarah');
    expect(toWinAnsi('a\u007Fb')).toBe('ab');
  });

  it('drops a soft hyphen instead of printing a visible one', () => {
    // U+00AD is a format character that cp1252 *does* encode, and pdf-lib maps
    // it to the same glyph as "-". Passing it through would print a hyphen the
    // input never had — and make two distinct roster rows render identically.
    expect(toWinAnsi('Anne­Marie Okafor')).toBe('AnneMarie Okafor');
    expect(toWinAnsi('Anne­Marie Okafor')).not.toBe(
      toWinAnsi('Anne-Marie Okafor'),
    );
  });

  it('collapses line and paragraph separators like a newline', () => {
    // A Word/web-form paste carries U+2028; the contract is that anything
    // line-break-ish becomes a space, not a visible "?".
    expect(toWinAnsi('Setup crew Cleanup crew')).toBe(
      'Setup crew Cleanup crew',
    );
    expect(toWinAnsi('a b')).toBe('a b');
    expect(toWinAnsi('a b')).toBe('a b');
  });

  it('never fabricates a number when folding a vulgar fraction', () => {
    // NFKD expands "⅓" to "1" + FRACTION SLASH + "3". Dropping the slash would
    // weld the digits: "1⅓ hrs" of service would print as "113 hrs".
    expect(toWinAnsi('Kitchen shift 1⅓ hrs')).toBe('Kitchen shift 1 1/3 hrs');
    expect(toWinAnsi('Ran ⅔ of the 5K')).toBe('Ran 2/3 of the 5K');
    // Directly encodable fractions are untouched.
    expect(toWinAnsi('½ and ¾')).toBe('½ and ¾');
  });

  it('drops combining marks that have no precomposed form', () => {
    // U+0323 (dot below) on "z" has no single cp1252 character; the base
    // letter must survive rather than the pair becoming noise.
    expect(toWinAnsi('ẓ')).toBe('z');
  });

  it('folds stroked letters that have no canonical decomposition', () => {
    // Ł/ł decompose to nothing, so without the explicit map a common Polish
    // surname would render as "?ukasz".
    expect(toWinAnsi('Łukasz Wróblewski')).toBe('Lukasz Wróblewski');
    expect(toWinAnsi('Đorđe')).toBe('Dorde');
  });

  it('replaces characters with no encodable form', () => {
    expect(toWinAnsi('李雷')).toBe('??');
    expect(toWinAnsi('ok 🎉')).toBe('ok ?');
  });

  it('emits at most one "?" per source character', () => {
    // Hangul syllables decompose into 2-3 jamo, none encodable. Marking each
    // part would print eight question marks for a three-character name and
    // blow past the column's fitText budget.
    expect(toWinAnsi('김철수')).toBe('???');
  });

  it('keeps the usable part of a mixed expansion', () => {
    // "ŉ" is U+02BC + "n": the modifier letter is unencodable, the "n" is not.
    expect(toWinAnsi('ŉ')).toBe('n');
    // "ẚ" is "a" + U+02BE — the base letter must survive alone.
    expect(toWinAnsi('ẚ')).toBe('a');
  });

  it('collapses newlines and tabs so a cell stays one line', () => {
    expect(toWinAnsi('line one\nline two\tend')).toBe('line one line two end');
  });
});

describe('formatCell', () => {
  it('renders empty for null and undefined', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });

  it('joins arrays, as roster roles arrive', () => {
    expect(formatCell(['President', 'Treasurer'])).toBe('President, Treasurer');
  });

  it('renders a points breakdown object as key: value pairs', () => {
    expect(formatCell({ ATTENDANCE: 12, SERVICE: 4 })).toBe(
      'ATTENDANCE: 12, SERVICE: 4',
    );
  });

  it('stringifies primitives', () => {
    expect(formatCell(0)).toBe('0');
    expect(formatCell(false)).toBe('false');
  });
});

describe('ReportPdfRenderer', () => {
  let renderer: ReportPdfRenderer;

  beforeEach(() => {
    renderer = new ReportPdfRenderer();
  });

  it('produces a parseable PDF with the report title as metadata', async () => {
    const bytes = await renderer.render(doc());

    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toBe('Attendance Report');
  });

  it('renders a one-page document when there are no rows', async () => {
    const bytes = await renderer.render(doc({ rows: [] }));

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  });

  it('paginates long reports', async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      member_name: `Member ${index}`,
      status: 'PRESENT',
    }));

    const parsed = await PDFDocument.load(await renderer.render(doc({ rows })));

    expect(parsed.getPageCount()).toBeGreaterThan(1);
    // Landscape Letter fits well under 100 rows per page; this guards against a
    // layout regression that silently drops rows onto one overflowing page.
    expect(parsed.getPageCount()).toBeLessThanOrEqual(10);
  });

  it('does not throw on names the standard fonts cannot encode', async () => {
    const rows = [
      { member_name: 'Łukasz Wróblewski', status: 'PRESENT' },
      { member_name: '李雷', status: 'ABSENT' },
      { member_name: 'Ana 🎉 Díaz', status: 'EXCUSED' },
    ];

    await expect(renderer.render(doc({ rows }))).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });

  it('renders a chapter name that cannot be encoded', async () => {
    await expect(
      renderer.render(
        doc({
          branding: {
            chapterName: 'Φ Γ Δ 兄弟会',
            university: 'Universität Köln',
            logo: null,
          },
        }),
      ),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it('embeds a valid PNG logo', async () => {
    // 1x1 transparent PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const bytes = await renderer.render(
      doc({
        branding: {
          chapterName: 'Tau Nu',
          university: 'RPI',
          logo: { bytes: new Uint8Array(png) },
        },
      }),
    );

    // Assert the image actually landed on the page. Merely loading the document
    // passes just as happily when embedLogo returns null, so it would not catch
    // every chapter silently losing its branding.
    expect(imageCount(await PDFDocument.load(bytes))).toBe(1);
  });

  it('renders without the logo when the bytes are not a usable image', async () => {
    const bytes = await renderer.render(
      doc({
        branding: {
          chapterName: 'Tau Nu',
          university: 'RPI',
          logo: { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
        },
      }),
    );

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(imageCount(parsed)).toBe(0);
  });

  it('tolerates rows missing a column and extra unmapped keys', async () => {
    const rows = [
      { member_name: 'Only Name' },
      { status: 'ABSENT', unmapped: 'ignored' },
    ];

    await expect(renderer.render(doc({ rows }))).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });
});

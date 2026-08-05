import { PDFDocument } from 'pdf-lib';
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

  it('replaces characters with no encodable form', () => {
    expect(toWinAnsi('李雷')).toBe('??');
    expect(toWinAnsi('ok 🎉')).toBe('ok ?');
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
          logo: { bytes: new Uint8Array(png), contentType: 'image/png' },
        },
      }),
    );

    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it('renders without the logo when the bytes are not a usable image', async () => {
    const bytes = await renderer.render(
      doc({
        branding: {
          chapterName: 'Tau Nu',
          university: 'RPI',
          logo: {
            bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
            contentType: 'image/png',
          },
        },
      }),
    );

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
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

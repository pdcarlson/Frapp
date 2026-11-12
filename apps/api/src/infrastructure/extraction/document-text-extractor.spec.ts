import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  DocumentTextExtractor,
  EXTRACT_MAX_BYTES,
  EXTRACT_MAX_PAGES,
} from './document-text-extractor';

const DOCX_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * A two-paragraph Word document ("Risk policy" / "Every event needs a sober
 * monitor."), zipped once and kept here so the spec reads a real .docx
 * without a fixture file.
 */
const DOCX = Buffer.from(
  [
    'UEsDBAoAAAAIALsRbF3MVIwQ4AAAAJwBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2Qy07DMBBF',
    'f8XyFsUTukAIJekCyhJYlA+w7Eli4Zc8bil/z6QtXaDC0r6PM7rd+hC82GMhl2Ivb1UrBUaTrItT',
    'L9+3z829XA/d9isjCbZG6uVca34AIDNj0KRSxsjKmErQlZ9lgqzNh54QVm17BybFirE2demQQ/eE',
    'o975KjYH/j5hC3qS4vFkXFi91Dl7Z3RlHfbR/qI0Z4Li5NFDs8t0wwYJVwmL8jfgnHvlHYqzKN50',
    'qS86sAs+U7Fgk9kFTqr/a67cmcbRGbzkl7ZckkEiHjh4dVGCdvHnfjjOPXwDUEsDBAoAAAAAALsR',
    'bF0AAAAAAAAAAAAAAAAGAAAAX3JlbHMvUEsDBAoAAAAIALsRbF02V97cogAAABgBAAALAAAAX3Jl',
    'bHMvLnJlbHONzzsOwjAMBuCrRN6pCwNCqGkXhNQVlQNEiZtGNA8l4XV7MjBQxMBo+/dnuekedmY3',
    'isl4x2Fd1cDISa+M0xzOw3G1g65tTjSLXBJpMiGxsuIShynnsEdMciIrUuUDuTIZfbQilzJqDEJe',
    'hCbc1PUW46cBS5P1ikPs1RrY8Az0j+3H0Ug6eHm15PKPE1+JIouoKXO4+6hQvdtVYQHbBhcvti9Q',
    'SwMECgAAAAAAuxFsXQAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAACAC7EWxdKDF0k7IAAAAG',
    'AQAAEQAAAHdvcmQvZG9jdW1lbnQueG1sbY9NagMxDIWvYrzveJpFKcP8rNoDhPQAjq1kTMaSkZxM',
    '5/axAyFQuvmEpMfTUz/9xkXdgCUQDvq9abUCdOQDngf9c/h++9TT2K+dJ3eNgFkVPUq3DnrOOXXG',
    'iJshWmkoAZbdiTjaXFo+m5XYJyYHIsUuLmbXth8m2oC6Wh7Jb7WmCq7I4z7IRSVagtt6UweV/GD6',
    'q/0qsTcFt5oKAbwoq4SOwCoShkzc/GNhnnfN66fxDlBLAQIUAAoAAAAIALsRbF3MVIwQ4AAAAJwB',
    'AAATAAAAAAAAAAAAAAAAAAAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQACgAAAAAAuxFsXQAA',
    'AAAAAAAAAAAAAAYAAAAAAAAAAAAQAAAAEQEAAF9yZWxzL1BLAQIUAAoAAAAIALsRbF02V97cogAA',
    'ABgBAAALAAAAAAAAAAAAAAAAADUBAABfcmVscy8ucmVsc1BLAQIUAAoAAAAAALsRbF0AAAAAAAAA',
    'AAAAAAAFAAAAAAAAAAAAEAAAAAACAAB3b3JkL1BLAQIUAAoAAAAIALsRbF0oMXSTsgAAAAYBAAAR',
    'AAAAAAAAAAAAAAAAACMCAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAABQAFACABAAAEAwAAAAA=',
  ].join(''),
  'base64',
);

async function pdf(pages: string[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = document.addPage([612, 792]);
    if (text) page.drawText(text, { x: 72, y: 700, size: 12, font });
  }
  return document.save();
}

const text = (value: string) => new TextEncoder().encode(value);

describe('DocumentTextExtractor', () => {
  const extractor = new DocumentTextExtractor();

  it('reads a PDF one section per page, so a passage keeps its page', async () => {
    const result = await extractor.extract({
      bytes: await pdf(['Dues are 225 dollars.', 'Fines are 25 dollars.']),
      contentType: 'application/pdf',
      fileName: 'bylaws.pdf',
    });
    expect(result).toEqual({
      status: 'ok',
      sections: [
        { heading: null, page: 1, text: 'Dues are 225 dollars.' },
        { heading: null, page: 2, text: 'Fines are 25 dollars.' },
      ],
    });
  });

  it('goes by the bytes, not by what the upload claimed to be', async () => {
    const result = await extractor.extract({
      bytes: await pdf(['Dues are 225 dollars.']),
      contentType: 'image/png',
      fileName: 'photo.png',
    });
    expect(result.status).toBe('ok');
  });

  it('skips a PDF with no text layer as having no text', async () => {
    await expect(
      extractor.extract({
        bytes: await pdf(['', '']),
        contentType: 'application/pdf',
        fileName: 'scan.pdf',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'no_text' });
  });

  it('skips a PDF past the page limit without reading it', async () => {
    await expect(
      extractor.extract({
        bytes: await pdf(new Array<string>(EXTRACT_MAX_PAGES + 1).fill('')),
        contentType: 'application/pdf',
        fileName: 'archive.pdf',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'too_large' });
  });

  it('skips a damaged PDF as unreadable', async () => {
    await expect(
      extractor.extract({
        bytes: text('%PDF-1.7 this is not really a pdf'),
        contentType: 'application/pdf',
        fileName: 'broken.pdf',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'unreadable' });
  });

  it('reads a Word document', async () => {
    const result = await extractor.extract({
      bytes: DOCX,
      contentType: DOCX_TYPE,
      fileName: 'risk-policy.docx',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].text).toContain('Risk policy');
    expect(result.sections[0].text).toContain(
      'Every event needs a sober monitor.',
    );
  });

  it('skips the other zip-based Office files, which it does not read', async () => {
    await expect(
      extractor.extract({
        bytes: DOCX,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: 'budget.xlsx',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'unsupported_type' });
  });

  it('reads plain text and CSV', async () => {
    await expect(
      extractor.extract({
        bytes: text('Quiet hours start at 11.'),
        contentType: 'text/plain',
        fileName: 'house-rules.txt',
      }),
    ).resolves.toEqual({
      status: 'ok',
      sections: [
        { heading: null, page: null, text: 'Quiet hours start at 11.' },
      ],
    });
    const csv = await extractor.extract({
      bytes: text('name,amount\nFormal,1200'),
      contentType: null,
      fileName: 'budget.csv',
    });
    expect(csv.status).toBe('ok');
  });

  it('skips an image, and binary bytes that call themselves text', async () => {
    await expect(
      extractor.extract({
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        contentType: 'image/png',
        fileName: 'composite.png',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'unsupported_type' });
    await expect(
      extractor.extract({
        bytes: new Uint8Array([0x41, 0x00, 0x42, 0x00]),
        contentType: 'text/plain',
        fileName: 'notes.txt',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'unsupported_type' });
  });

  it('skips an empty text file, and anything over the upload limit', async () => {
    await expect(
      extractor.extract({
        bytes: text('  \n '),
        contentType: 'text/plain',
        fileName: 'empty.txt',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'no_text' });
    await expect(
      extractor.extract({
        bytes: new Uint8Array(EXTRACT_MAX_BYTES + 1),
        contentType: 'application/pdf',
        fileName: 'huge.pdf',
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'too_large' });
  });
});

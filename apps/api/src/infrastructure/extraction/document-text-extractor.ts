import { MAX_UPLOAD_BYTES } from '@repo/validation';
import { Injectable } from '@nestjs/common';
import { extractRawText } from 'mammoth';
import type {
  ExtractedDocumentText,
  IDocumentTextExtractor,
} from '#domain/adapters/document-text-extractor.interface';
import type { CorpusSection } from '#domain/utils/corpus-chunker';

/** The upload limit for a document; nothing larger is opened. */
export const EXTRACT_MAX_BYTES = MAX_UPLOAD_BYTES;
/** A PDF with more pages than this is skipped, not half read. */
export const EXTRACT_MAX_PAGES = 500;
/** About 375,000 tokens: more text than this from one file is skipped. */
const EXTRACT_MAX_CHARS = 1_500_000;

const DOCX_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PLAIN_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv']);

type Format = 'pdf' | 'docx' | 'plain' | 'other';

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * The format, from the bytes first. The declared type only separates what
 * the bytes cannot: a .docx from the other zip-based Office files, and text
 * from everything that has no signature.
 */
function formatOf(
  bytes: Uint8Array,
  contentType: string | null,
  fileName: string,
): Format {
  const extension = extensionOf(fileName);
  const declared = (contentType ?? '').toLowerCase().split(';')[0].trim();
  // "%PDF-". Some writers put a few bytes before it.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  if (head.includes('%PDF-')) return 'pdf';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return declared === DOCX_TYPE || extension === 'docx' ? 'docx' : 'other';
  }
  const saysText =
    declared.startsWith('text/') || PLAIN_EXTENSIONS.has(extension);
  // A file that says it is text and holds a NUL in its first bytes is not.
  if (saysText && !bytes.subarray(0, 8192).includes(0)) return 'plain';
  return 'other';
}

/**
 * Reads the text out of a chapter document for the AI index (#720): the text
 * layer of a PDF (`unpdf`, one section per page so a passage keeps its page
 * numbers), a Word document's text (`mammoth`), or a plain text file. Other
 * formats the library accepts (slides, spreadsheets, legacy Office, images)
 * are skipped as `unsupported_type`, and a PDF that is only scanned pages as
 * `no_text`. Nothing here calls a model or the network.
 *
 * It runs in the API process, so it refuses a file past the page and size
 * limits above without reading further.
 */
@Injectable()
export class DocumentTextExtractor implements IDocumentTextExtractor {
  async extract(file: {
    bytes: Uint8Array;
    contentType: string | null;
    fileName: string;
  }): Promise<ExtractedDocumentText> {
    if (file.bytes.byteLength > EXTRACT_MAX_BYTES) {
      return { status: 'skipped', reason: 'too_large' };
    }
    const format = formatOf(file.bytes, file.contentType, file.fileName);
    if (format === 'other') {
      return { status: 'skipped', reason: 'unsupported_type' };
    }

    let sections: CorpusSection[];
    try {
      if (format === 'pdf') {
        const pages = await this.pdfPages(file.bytes);
        if (pages === 'too_large') {
          return { status: 'skipped', reason: 'too_large' };
        }
        sections = pages;
      } else if (format === 'docx') {
        sections = [
          { heading: null, page: null, text: await this.docxText(file.bytes) },
        ];
      } else {
        const text = new TextDecoder('utf-8').decode(file.bytes);
        sections = [{ heading: null, page: null, text }];
      }
    } catch {
      // An encrypted or damaged file, or one that is not what it claims.
      // The parser's message can quote the file, so it is not logged.
      return { status: 'skipped', reason: 'unreadable' };
    }

    const length = sections.reduce((sum, s) => sum + s.text.trim().length, 0);
    if (length === 0) return { status: 'skipped', reason: 'no_text' };
    if (length > EXTRACT_MAX_CHARS) {
      return { status: 'skipped', reason: 'too_large' };
    }
    return { status: 'ok', sections };
  }

  private async pdfPages(
    bytes: Uint8Array,
  ): Promise<CorpusSection[] | 'too_large'> {
    // `unpdf` is ESM only, so it is loaded when first needed. pdf.js takes
    // ownership of the buffer it is given, hence the copy.
    const { extractText, getDocumentProxy } = await import('unpdf');
    // Verbosity 0: pdf.js otherwise warns to the console about a damaged
    // file, and those lines can quote it.
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    try {
      if (pdf.numPages > EXTRACT_MAX_PAGES) return 'too_large';
      const { text } = await extractText(pdf, { mergePages: false });
      return text.map((pageText, index) => ({
        heading: null,
        page: index + 1,
        text: pageText,
      }));
    } finally {
      await pdf.loadingTask.destroy();
    }
  }

  private async docxText(bytes: Uint8Array): Promise<string> {
    const result = await extractRawText({ buffer: Buffer.from(bytes) });
    return result.value;
  }
}

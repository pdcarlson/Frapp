import type { CorpusSkipReason } from '../entities/corpus.entity';
import type { CorpusSection } from '../utils/corpus-chunker';

export const DOCUMENT_TEXT_EXTRACTOR = 'DOCUMENT_TEXT_EXTRACTOR';

export type ExtractedDocumentText =
  | { status: 'ok'; sections: CorpusSection[] }
  | { status: 'skipped'; reason: CorpusSkipReason };

/**
 * Reads the words out of an uploaded file for the AI index (#720). It runs
 * no model: a page with no text layer has no words here, and the document is
 * then skipped as `no_text` (reading scanned pages is a later step).
 *
 * The declared content type is the uploader's claim, so an implementation
 * decides the format from the bytes and uses the claim only to tell formats
 * the bytes cannot.
 */
export interface IDocumentTextExtractor {
  extract(file: {
    bytes: Uint8Array;
    contentType: string | null;
    fileName: string;
  }): Promise<ExtractedDocumentText>;
}

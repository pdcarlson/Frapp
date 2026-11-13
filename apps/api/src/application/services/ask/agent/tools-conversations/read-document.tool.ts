import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { CorpusRetrievalService } from '../../../corpus/corpus-retrieval.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import { fitSources, nothing, recordId } from './conversation-lines';
import { DOCUMENT_SOURCE_TYPE, recordSource } from './search-records.tool';

/**
 * Passages in one part. A passage is at most 2,400 characters
 * (`CORPUS_CHUNK_MAX_CHARS`), so five are what one result can hold.
 */
export const DOCUMENT_PART_PASSAGES = 5;
const MAX_PART = 400;

const input = z.object({
  document: z
    .string()
    .min(1)
    .max(160)
    .describe(
      'The id of a document source from an earlier result ("document:...").',
    ),
  part: z
    .number()
    .int()
    .min(1)
    .max(MAX_PART)
    .default(1)
    .describe(
      'Which part of a long document, counted from 1. The result says how many parts there are.',
    ),
});
type Args = z.infer<typeof input>;

/**
 * One uploaded document read in order, a part at a time: the text the
 * chapter's index holds for it, which is what a search of it matches and
 * what a citation of it is checked against.
 *
 * `GET /v1/documents/:id` hands a member the file. A model is handed the
 * file's text instead, and the only text Frapp has is the index's, so this
 * reads through `CorpusRetrievalService.readSource`: the member must be
 * able to open the library (the retrieval's rule for a document), and the
 * read is the database function that takes the chapter and the member, like
 * the search. A scan, an image or a file type the indexer does not read
 * has no text here, and the result says so.
 */
@Injectable()
export class ReadDocumentTool implements AgentReadTool<Args> {
  readonly name = 'read_document';
  readonly description =
    'Reads one uploaded document in full, a part at a time, by the id of a document source that search_records returned. Use it when a passage is not enough: to read a whole section of the bylaws, or everything a policy says.';
  readonly reading = 'Reading the document';
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'documents';
  readonly effect = 'read' as const;
  readonly input = input;

  constructor(private readonly retrieval: CorpusRetrievalService) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId } = context;
    const documentId = recordId(args.document, 'document');
    const read = documentId
      ? await this.retrieval.readSource({
          chapterId,
          actingUserId: context.userId,
          sourceType: DOCUMENT_SOURCE_TYPE,
          sourceId: documentId,
          offset: (args.part - 1) * DOCUMENT_PART_PASSAGES,
          limit: DOCUMENT_PART_PASSAGES,
        })
      : null;
    if (!read || read.chunks.length === 0) {
      return nothing(
        chapterId,
        args.part > 1
          ? 'That document has no such part.'
          : 'That document cannot be read here: it is not one you can open, or it has no text Frapp can read (a scan, an image or a slide deck).',
      );
    }
    const parts = Math.max(Math.ceil(read.total / DOCUMENT_PART_PASSAGES), 1);
    const fitted = fitSources(
      read.chunks.map((chunk) =>
        recordSource({
          id: chunk.id,
          sourceType: DOCUMENT_SOURCE_TYPE,
          sourceId: documentId as string,
          title: read.title,
          heading: chunk.heading,
          text: chunk.content,
          pageStart: chunk.page_start,
          sourceAt: read.source_at,
        }),
      ),
    );
    const notes = [
      parts > 1
        ? `Part ${args.part} of ${parts}.${
            args.part < parts
              ? ` Pass part ${args.part + 1} for what follows.`
              : ''
          }`
        : null,
      fitted.cut ? 'The end of this part did not fit and is cut.' : null,
    ].filter(Boolean);
    return {
      chapterId,
      sources: fitted.sources,
      entities: [],
      note: notes.length > 0 ? notes.join(' ') : null,
      leftOutMessages: 0,
    };
  }
}

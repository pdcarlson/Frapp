import { Injectable } from '@nestjs/common';
import { isModuleEnabled } from '@repo/validation';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import type { CorpusSourceType } from '#domain/entities/corpus.entity';
import {
  CorpusRetrievalService,
  type CorpusPassage,
} from '../../../corpus/corpus-retrieval.service';
import type {
  AgentReadTool,
  AgentSource,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  BAD_DATES_NOTE,
  fitSources,
  nothing,
  readDateRange,
} from './conversation-lines';

export const DOCUMENT_SOURCE_TYPE: CorpusSourceType = 'chapter_document';
export const MINUTES_SOURCE_TYPE: CorpusSourceType = 'meeting_minutes';

/**
 * Passages asked for. A passage is at most 2,400 characters and most are
 * well under, so eight usually fit a result; when they do not, the last
 * ones are left off and the note says so.
 */
const PASSAGES = 8;

/** What each kind of record is, and the module its own routes sit behind. */
const KINDS = [
  { kind: 'documents', sourceType: DOCUMENT_SOURCE_TYPE, module: 'documents' },
  { kind: 'minutes', sourceType: MINUTES_SOURCE_TYPE, module: 'meetings' },
] as const;

const input = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'What to look for in the chapter\'s documents and meeting minutes: a few words on the topic ("quorum for elections").',
    ),
  kind: z
    .enum(['any', 'documents', 'minutes'])
    .default('any')
    .describe(
      'Which records: "documents" for bylaws, policies and other uploaded files, "minutes" for posted meeting minutes, "any" for both.',
    ),
  since: z
    .string()
    .max(40)
    .default('')
    .describe(
      'Only records dated from this day on, as 2026-09-01: a meeting by when it was held, a document by its effective date.',
    ),
  until: z
    .string()
    .max(40)
    .default('')
    .describe('Only records dated up to the end of this day, as 2026-11-07.'),
});
type Args = z.infer<typeof input>;

/** A passage of a document or of minutes as a source. */
export function recordSource(passage: {
  id: string;
  sourceType: string;
  sourceId: string;
  title: string;
  heading: string | null;
  text: string;
  pageStart: number | null;
  sourceAt: string | null;
}): AgentSource {
  const minutes = passage.sourceType === MINUTES_SOURCE_TYPE;
  const page = passage.pageStart === null ? null : `page ${passage.pageStart}`;
  return {
    // The passage's own id is the last part, so the same passage found by a
    // search and read from its document is one source.
    id: `${minutes ? 'meeting' : 'document'}:${passage.sourceId}:${passage.id}`,
    kind: minutes ? 'minutes' : 'document',
    title: passage.title,
    detail: [passage.heading, page].filter(Boolean).join(', ') || null,
    date: passage.sourceAt,
    target: minutes
      ? { type: 'meeting', meeting_id: passage.sourceId }
      : {
          type: 'document',
          document_id: passage.sourceId,
          page: passage.pageStart,
        },
    text: passage.text,
    chat: false,
    authorIds: [],
    audience: { type: minutes ? 'meeting' : 'document', id: passage.sourceId },
  };
}

/**
 * The chapter's official record, searched: uploaded documents and posted
 * minutes, by meaning and by words (`CorpusRetrievalService`, the search Ask
 * already runs), narrowed in the database to the kind and the dates asked
 * for. Chat is not searched here; `search_messages` does that, and an
 * answer keeps the two apart (`spec/behavior/ai.md` § Chat as a source).
 *
 * What the asker may open is the retrieval's own check, per source: minutes
 * by who the meeting's event invites, documents by who may open the
 * library. A kind whose module the chapter has switched off is not
 * searched, as its own routes would refuse.
 */
@Injectable()
export class SearchRecordsTool implements AgentReadTool<Args> {
  readonly name = 'search_records';
  readonly description =
    "Searches the chapter's uploaded documents (bylaws, policies, calendars) and posted meeting minutes, by words and by meaning. Can be narrowed to documents or to minutes, and to a stretch of days. Returns passages; read_document and read_minutes read one in full.";
  readonly reading = 'Searching documents and minutes';
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  // Two modules, checked per kind in `run`: with one off the other still
  // answers, and with both off there is nothing to search.
  readonly module = null;
  readonly effect = 'read' as const;
  readonly input = input;

  constructor(private readonly retrieval: CorpusRetrievalService) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId } = context;
    const sourceTypes = KINDS.filter(
      (entry) =>
        (args.kind === 'any' || args.kind === entry.kind) &&
        isModuleEnabled(context.enabledModules, entry.module),
    ).map((entry) => entry.sourceType);
    if (sourceTypes.length === 0) {
      return nothing(
        chapterId,
        'This chapter does not have that kind of record turned on.',
      );
    }
    const range = readDateRange(args.since, args.until, context.timeZone);
    if (!range) return nothing(chapterId, BAD_DATES_NOTE);

    const retrieved = await this.retrieval.retrieve(
      {
        chapterId,
        actingUserId: context.userId,
        query: args.query,
        limit: PASSAGES,
        filter: {
          sourceTypes,
          ...(range.from ? { since: range.from.toISOString() } : {}),
          ...(range.before ? { until: range.before.toISOString() } : {}),
        },
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      },
      context.now,
    );
    if (retrieved.status !== 'ok') {
      return nothing(
        chapterId,
        'Documents and minutes cannot be searched right now.',
      );
    }
    // The filter asked for these types; this holds the result to them even
    // against a database that does not narrow yet.
    const passages = retrieved.passages.filter((passage: CorpusPassage) =>
      sourceTypes.some((type) => type === passage.sourceType),
    );
    const fitted = fitSources(passages.map(recordSource));
    return {
      chapterId,
      sources: fitted.sources,
      entities: [],
      note:
        fitted.sources.length === 0
          ? 'Nothing in the documents or minutes you can open matched.'
          : fitted.cut
            ? 'More matched than fits here: passages were left off or the last one is cut short. Narrow the search, or read the document or the minutes in full.'
            : null,
      leftOutMessages: 0,
    };
  }
}

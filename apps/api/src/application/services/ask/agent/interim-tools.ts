import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  ASK_COPY,
  ASK_SOURCE_KINDS,
  type AskSourceKind,
} from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import { AiConsentService } from '../../ai/ai-consent.service';
import { chatPassagesStillAllowed } from '../../corpus/chat-message-corpus-source';
import { CorpusRetrievalService } from '../../corpus/corpus-retrieval.service';
import {
  passageDetail,
  passageIsChat,
  passageKind,
  passageTarget,
} from '../ask-passage';
import type { AskTool } from '../ask-tool';
import {
  AgentToolUnavailableError,
  type AgentReadTool,
  type AgentToolContext,
  type AgentToolResult,
} from './agent-tool';

/**
 * What the agent loop reads with until the tool slices land (#4900, #4901):
 * the six live reads the one-shot Ask already has, each offered as a tool
 * with no arguments, and one search of the chapter's index. They are here so
 * the loop can be run and graded end to end behind its switch; the cutover
 * deletes this file with `ask-tools.ts`.
 */

const KINDS: ReadonlySet<string> = new Set(ASK_SOURCE_KINDS);

function nothing(chapterId: string, note: string | null): AgentToolResult {
  return { chapterId, sources: [], entities: [], note, leftOutMessages: 0 };
}

/** One of Ask's no-argument live reads, as a tool the loop can call. */
export function agentToolFromAskTool(
  tool: AskTool,
): AgentReadTool<Record<string, never>> {
  if (tool.effect !== 'read') {
    throw new Error(`Ask tool ${tool.name} is not a read`);
  }
  const words = ASK_COPY.reads[tool.name];
  return {
    name: tool.name,
    description: tool.description,
    permission: tool.permission,
    module: tool.module,
    effect: 'read',
    input: z.object({}),
    reading: words ? `Reading ${words}` : `Reading ${tool.title}`,
    async run(_args, context: AgentToolContext): Promise<AgentToolResult> {
      const result = await tool.run({
        chapterId: context.chapterId,
        userId: context.userId,
        now: context.now,
        timeZone: context.timeZone,
      });
      if (!result || !result.text.trim()) {
        return nothing(context.chapterId, 'Nothing there.');
      }
      return {
        // The tool's own word for where it read, so the loop can refuse it.
        chapterId: result.chapterId,
        sources: [
          {
            id: `tool:${tool.name}`,
            kind: tool.kind,
            title: tool.title,
            detail: null,
            date: null,
            target: { type: 'page', page: tool.page },
            text: result.text,
            chat: false,
            authorIds: [],
          },
        ],
        entities: [],
        note: null,
        leftOutMessages: 0,
      };
    },
  };
}

const SEARCH_LIMIT = 8;

const SearchChapterArgs = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe(
      'A few words to search for, as they would appear in the document or the conversation.',
    ),
});

/**
 * The chapter's index, searched as the asker: documents, meeting minutes,
 * announcements and channel messages, by meaning and by words. It reads
 * through `CorpusRetrievalService`, which keeps to the asker's chapter and to
 * what they can open, and chat gets its last consent check here, at the
 * moment it is about to reach a model (#4314).
 */
@Injectable()
export class SearchChapterAgentTool implements AgentReadTool<
  z.infer<typeof SearchChapterArgs>
> {
  readonly name = 'search_chapter';
  readonly description =
    "Search the chapter's documents, meeting minutes, announcements and channel messages. Returns the passages that match best. Search again with other words when the first search misses.";
  /** The permission Ask's own route asks for. */
  readonly permission = SystemPermissions.AI_USE;
  readonly module = null;
  readonly effect = 'read' as const;
  readonly input = SearchChapterArgs;
  readonly reading = 'Searching the chapter';

  constructor(
    private readonly retrieval: CorpusRetrievalService,
    private readonly consent: AiConsentService,
  ) {}

  async run(
    args: z.infer<typeof SearchChapterArgs>,
    context: AgentToolContext,
  ): Promise<AgentToolResult> {
    const retrieved = await this.retrieval.retrieve(
      {
        chapterId: context.chapterId,
        actingUserId: context.userId,
        query: args.query,
        limit: SEARCH_LIMIT,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      },
      context.now,
    );
    // The search itself was not allowed or not paid for. Its embedding is
    // another provider's call than the round's, so the next round may well
    // be admitted: the turn ends here, with the reason.
    if (retrieved.status !== 'ok') {
      throw new AgentToolUnavailableError(retrieved);
    }
    const allowed = await chatPassagesStillAllowed(
      retrieved.passages,
      context.chapterId,
      this.consent,
    );
    const kindOf = (kind: string): AskSourceKind =>
      KINDS.has(kind) ? (kind as AskSourceKind) : 'document';
    return {
      chapterId: context.chapterId,
      sources: allowed.passages.map((passage) => {
        const chat = passageIsChat(passage);
        return {
          id: `passage:${passage.id}`,
          kind: kindOf(passageKind(passage)),
          title: passage.title,
          // A chat passage's heading is its day, which `date` already says.
          detail: chat ? null : passageDetail(passage),
          date: passage.sourceAt,
          target: passageTarget(passage),
          text: passage.text,
          chat,
          authorIds: chat ? passage.authorIds : [],
        };
      }),
      entities: [],
      note: allowed.passages.length === 0 ? 'No passage matched.' : null,
      leftOutMessages: retrieved.leftOutMessages + allowed.withheldMessages,
    };
  }
}

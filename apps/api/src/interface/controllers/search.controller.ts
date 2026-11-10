import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  SearchService,
  type SearchFilters,
} from '../../application/services/search.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import { ThrottleExpensiveRead } from '../decorators/throttle-profiles.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  SEARCH_MESSAGE_HAS,
  type SearchMessageHas,
} from '#domain/repositories/search.repository.interface';

/**
 * Coerce the raw `channelId` query value to a single trimmed id, or `undefined`
 * for anything that is not one.
 *
 * `@Query()` hands back whatever `qs` parsed, which is **not** always a string:
 * `?channelId=a&channelId=b` yields an array and `?channelId[k]=v` an object,
 * and Nest's `ValidationPipe` does not coerce a `String` metatype. A bare
 * `.trim()` therefore threw `channelId.trim is not a function` and turned a
 * malformed read into a 500. Anything that is not a non-empty string is treated
 * as absent — the same chapter-wide search the parameter's omission gives —
 * rather than being rejected, because a duplicated query param is a client bug
 * that should degrade, not an attack that needs an error.
 */
function normalizeId(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw.trim() || undefined : undefined;
}

/**
 * A date filter as an ISO instant, `undefined` when absent.
 *
 * Unlike a malformed `channelId`, a filter that cannot be read is a 400, not a
 * silent drop: dropping `after=yesterdy` would answer a narrower question with
 * a wider result and no sign that it had.
 */
function parseInstant(name: string, raw: unknown): string | undefined {
  const value = normalizeId(raw);
  if (value === undefined) {
    if (raw === undefined || typeof raw === 'string') return undefined;
    throw new BadRequestException(`${name} must be a single ISO 8601 date`);
  }
  const ms = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(ms)) {
    throw new BadRequestException(`${name} must be an ISO 8601 date`);
  }
  return new Date(ms).toISOString();
}

/** `has` as a de-duplicated list; accepts `has=a,b` and `has=a&has=b`. */
function parseHas(raw: unknown): SearchMessageHas[] | undefined {
  if (raw === undefined) return undefined;
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((part: unknown) =>
    typeof part === 'string' ? part.split(',') : [null],
  );
  const values = new Set<SearchMessageHas>();
  for (const part of parts) {
    const value = part?.trim();
    if (value === '') continue;
    if (!(SEARCH_MESSAGE_HAS as readonly unknown[]).includes(value)) {
      throw new BadRequestException(
        `has must be one or more of: ${SEARCH_MESSAGE_HAS.join(', ')}`,
      );
    }
    values.add(value as SearchMessageHas);
  }
  return values.size ? [...values] : undefined;
}

@ApiTags('Search')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ThrottleExpensiveRead()
  @ApiOperation({
    summary: 'Cross-domain search (backwork, events, members, messages)',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search query' })
  @ApiQuery({
    name: 'channelId',
    required: false,
    // Declared explicitly because the handler param is typed `unknown` (the
    // runtime value is whatever `qs` parsed, which is not always a string).
    // Without this the emitted contract carries an empty schema and the SDK
    // generates `channelId?: unknown` — the only untyped parameter in the file,
    // and one that would let a caller pass an object with no type error.
    type: String,
    description:
      'Narrow the search to one chat channel. This is the single-channel form ' +
      'of search specified in spec/behavior/chat/README.md: only the `messages` ' +
      'source runs and `backwork`, `events` and `members` come back empty. The ' +
      'channel is still resolved through the caller’s accessible-channel set, ' +
      'so an unreadable or unknown id returns no matches rather than an error.',
  })
  @ApiQuery({
    name: 'fromUserId',
    required: false,
    type: String,
    description:
      'Message hits from this sender only. Like every filter below it narrows ' +
      'the messages source inside the caller’s accessible-channel set, makes ' +
      'the search messages-only, and lets `q` be empty.',
  })
  @ApiQuery({
    name: 'after',
    required: false,
    type: String,
    description: 'Message hits sent at or after this ISO 8601 date or instant.',
  })
  @ApiQuery({
    name: 'before',
    required: false,
    type: String,
    description: 'Message hits sent before this ISO 8601 date or instant.',
  })
  @ApiQuery({
    name: 'has',
    required: false,
    type: String,
    description:
      'Message hits that carry all of these, comma-separated: `file` (any ' +
      'attachment), `image`, `link`, `poll`.',
  })
  async search(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query('q') query: string,
    @Res({ passthrough: true }) res: Response,
    @Query('channelId') channelId?: unknown,
    @Query('fromUserId') fromUserId?: unknown,
    @Query('after') after?: unknown,
    @Query('before') before?: unknown,
    @Query('has') has?: unknown,
  ) {
    const filters: SearchFilters = {
      channelId: normalizeId(channelId),
      fromUserId: normalizeId(fromUserId),
      after: parseInstant('after', after),
      before: parseInstant('before', before),
      has: parseHas(has),
    };
    const { results, timedOut, timedOutSources } =
      await this.searchService.searchWithinBudget(
        chapterId,
        userId,
        typeof query === 'string' ? query : '',
        filters,
      );
    if (timedOut) {
      res.setHeader('x-search-timeout', '1');
      // Which sections are incomplete, so a client can say "still searching
      // messages" instead of rendering an empty list as "no matches". The
      // boolean header stays for callers that already read it; the budget is
      // per-source now, so `1` means "at least one section is short", not
      // "everything came back empty".
      res.setHeader('x-search-timeout-sources', timedOutSources.join(','));
    }
    return results;
  }
}

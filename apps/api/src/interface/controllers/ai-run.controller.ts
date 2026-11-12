import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AiRunService,
  type AiRunView,
} from '../../application/services/ai-run.service';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  AiRunDto,
  AiRunIdParamDto,
  ListAiRunsQueryDto,
} from '../dtos/ai-run.dto';

/**
 * The read path for background AI runs (#4310): enough for a client to show
 * "Drafting minutes" and how it ended, by polling. Runs are started by the
 * feature that owns them (a minutes draft, an index job), never here.
 *
 * `MEMBERS_VIEW` is the baseline every member holds; who may read a given run
 * is decided per run by `AiRunService` (the member who started it, the member
 * it acts for, or a permission the kind names). With `AI_ENABLED` off both
 * routes answer 404 `ai.not_available`.
 */
@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('ai/runs')
export class AiRunController {
  constructor(private readonly aiRuns: AiRunService) {}

  @Get()
  @ApiOperation({
    summary: "List the caller's AI runs",
    description:
      'Runs the caller started or that act for them, in the current chapter, newest first. 404 `ai.not_available` while AI is off on this server.',
  })
  @ApiOkResponse({ type: AiRunDto, isArray: true })
  @ApiNotFoundResponse({
    description: 'AI is off on this server (`ai.not_available`).',
  })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListAiRunsQueryDto,
  ): Promise<AiRunView[]> {
    return this.aiRuns.listForMember(chapterId, userId, {
      kind: query.kind,
      limit: query.limit ?? 20,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one AI run',
    description:
      "A run's status and outcome. Readable by the member who started it, the member it acts for, and members holding a permission its kind names; anyone else gets 404, as for a run that does not exist.",
  })
  @ApiOkResponse({ type: AiRunDto })
  @ApiNotFoundResponse({
    description:
      'No such run in this chapter, not readable by the caller, or AI is off (`ai.not_available`).',
  })
  async get(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param() params: AiRunIdParamDto,
  ): Promise<AiRunView> {
    return this.aiRuns.getForMember(chapterId, userId, params.id);
  }
}

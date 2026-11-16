import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  PredictionService,
  type PredictionActor,
  type PredictionMarketView,
} from '../../application/services/prediction.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentEnabledModules,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  ConfirmPredictionDto,
  CreatePredictionDto,
  ListPredictionsQueryDto,
  PlacePredictionStakeDto,
  PredictionConsentDto,
  PredictionMarketViewDto,
  QuestionPredictionDto,
  SettlePredictionDto,
} from '../dtos/prediction.dto';

/**
 * Predictions (#5133, `spec/behavior/predictions.md`). Off unless a chapter
 * turns the module on, which the service checks: an absent `predictions` key
 * reads as off here, unlike `@RequireModule`, which reads it as on.
 *
 * Every route needs `members:view`; who may settle, question or void one
 * market depends on the market, so the service decides those.
 */
@ApiTags('Predictions')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('predictions')
export class PredictionController {
  constructor(
    private readonly predictions: PredictionService,
    private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List predictions the caller can see' })
  @ApiOkResponse({ type: [PredictionMarketViewDto] })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Query() query: ListPredictionsQueryDto,
  ): Promise<PredictionMarketView[]> {
    const actor = this.actor(chapterId, userId, enabledModules);
    this.predictions.assertEnabled(enabledModules);
    return this.predictions.list(actor, query.filter ?? 'open');
  }

  @Get(':id')
  @ApiOperation({ summary: 'One prediction with its pools and stakers' })
  @ApiOkResponse({ type: PredictionMarketViewDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
  ): Promise<PredictionMarketView> {
    const actor = this.actor(chapterId, userId, enabledModules);
    this.predictions.assertEnabled(enabledModules);
    return this.predictions.get(actor, id);
  }

  @Post()
  @RequirePermissions(SystemPermissions.PREDICTIONS_CREATE)
  @ApiOperation({ summary: 'Ask a prediction in a channel' })
  @ApiOkResponse({ type: PredictionMarketViewDto })
  @HttpCode(200)
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Body() dto: CreatePredictionDto,
  ): Promise<PredictionMarketView> {
    const actor = this.actor(chapterId, userId, enabledModules);
    return this.predictions.create(actor, {
      channelId: dto.channel_id,
      question: dto.question,
      settleRule: dto.settle_rule,
      answers: dto.answers,
      closesAt: dto.closes_at,
      settlerId: dto.settler_id ?? null,
      namedMemberId: dto.named_member_id ?? null,
      clientMessageId: dto.client_message_id ?? null,
    });
  }

  @Post(':id/stakes')
  @ApiOperation({ summary: 'Stake points on an answer' })
  @ApiOkResponse({ type: PredictionMarketViewDto })
  @HttpCode(200)
  async stake(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Body() dto: PlacePredictionStakeDto,
  ): Promise<PredictionMarketView> {
    const actor = this.actor(chapterId, userId, enabledModules);
    return this.predictions.stake(actor, id, {
      answerId: dto.answer_id,
      amount: dto.amount,
      clientMessageId: dto.client_message_id,
    });
  }

  @Post(':id/consent')
  @ApiOperation({
    summary: 'The member a prediction names agrees to it, or withdraws it',
  })
  @ApiOkResponse({ type: PredictionMarketViewDto })
  @HttpCode(200)
  async consent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Body() dto: PredictionConsentDto,
  ): Promise<PredictionMarketView> {
    const actor = this.actor(chapterId, userId, enabledModules);
    return this.predictions.consent(actor, id, dto.agree);
  }

  @Post(':id/settle')
  @ApiOperation({
    summary: 'The settler names the winning answer; it pays after 24 hours',
  })
  @ApiOkResponse({ type: PredictionMarketViewDto })
  @HttpCode(200)
  async settle(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Body() dto: SettlePredictionDto,
  ): Promise<PredictionMarketView> {
    const actor = this.actor(chapterId, userId, enabledModules);
    return this.predictions.settle(actor, id, {
      answerId: dto.answer_id,
      note: dto.note ?? null,
      knownAt: dto.known_at ?? null,
    });
  }

  @Post(':id/questions')
  @ApiOperation({
    summary: 'A staker questions the result within its 24-hour window',
  })
  @ApiOkResponse({ type: PredictionMarketViewDto })
  @HttpCode(200)
  async question(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Body() dto: QuestionPredictionDto,
  ): Promise<PredictionMarketView> {
    const actor = this.actor(chapterId, userId, enabledModules);
    return this.predictions.question(actor, id, dto.note);
  }

  @Post(':id/confirm')
  @RequirePermissions(SystemPermissions.PREDICTIONS_MANAGE)
  @ApiOperation({
    summary:
      'Pay a settled result now, or settle it again on another answer (reverses a paid round)',
  })
  @ApiOkResponse({ type: PredictionMarketViewDto })
  @HttpCode(200)
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Body() dto: ConfirmPredictionDto,
  ): Promise<PredictionMarketView> {
    const actor = this.actor(chapterId, userId, enabledModules);
    return this.predictions.confirm(actor, id, dto.answer_id ?? null);
  }

  @Post(':id/void')
  @ApiOperation({
    summary:
      'Void a prediction and refund every stake (its settler before payout, predictions:manage any time)',
  })
  @ApiOkResponse({ type: PredictionMarketViewDto })
  @HttpCode(200)
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
  ): Promise<PredictionMarketView> {
    const permissions = await this.rbac.getEffectivePermissions(
      chapterId,
      userId,
    );
    return this.predictions.void(
      this.actor(chapterId, userId, enabledModules),
      id,
      {
        manages:
          permissions.includes('*') ||
          permissions.includes(SystemPermissions.PREDICTIONS_MANAGE),
      },
    );
  }

  private actor(
    chapterId: string,
    userId: string,
    enabledModules: Record<string, boolean> | null,
  ): PredictionActor {
    return { chapterId, userId, enabledModules };
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { InviteService } from '../../application/services/invite.service';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier, GraceBlocked } from '../decorators/subscription.decorator';
import {
  ThrottleExpensiveWrite,
  ThrottleFanOutWrite,
} from '../decorators/throttle-profiles.decorator';
import {
  CurrentUser,
  CurrentChapterId,
} from '../decorators/current-user.decorator';
import {
  CreateInviteDto,
  BatchCreateInvitesDto,
  BulkEmailInviteDto,
  RedeemInviteDto,
  PreviewInviteDto,
  InvitePreviewResponseDto,
} from '../dtos/invite.dto';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  FeatureEvent,
  type FeatureEventInput,
} from '../decorators/feature-event.decorator';
import type { Invite } from '#domain/entities/invite.entity';
import type { BulkEmailInviteResult } from '../../application/services/invite.service';

@ApiTags('Invites')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@UseInterceptors(AuthSyncInterceptor)
@FreeTier()
@Controller('invites')
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  @Post()
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @GraceBlocked()
  @ApiOperation({ summary: 'Generate an invite token' })
  @FeatureEvent('invite-created', () => ({ invite_method: 'link', count: 1 }))
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateInviteDto,
  ) {
    return this.inviteService.create(chapterId, userId, dto.role);
  }

  @Post('batch')
  @ThrottleExpensiveWrite()
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @GraceBlocked()
  @ApiOperation({ summary: 'Generate multiple invite tokens' })
  @FeatureEvent(
    'invite-created',
    ({ result }: FeatureEventInput<BatchCreateInvitesDto, Invite[]>) => ({
      invite_method: 'batch',
      count: result.length,
    }),
  )
  async createBatch(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: BatchCreateInvitesDto,
  ) {
    return this.inviteService.createBatch(
      chapterId,
      userId,
      dto.role,
      dto.count,
    );
  }

  @Post('email')
  @ThrottleExpensiveWrite()
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @GraceBlocked()
  @ApiOperation({
    summary: 'Generate invite tokens and email each address a join link',
  })
  @FeatureEvent(
    'invite-created',
    ({
      result,
    }: FeatureEventInput<BulkEmailInviteDto, BulkEmailInviteResult>) => ({
      invite_method: 'email',
      count: result.invites.length,
    }),
  )
  async createWithEmails(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: BulkEmailInviteDto,
  ) {
    return this.inviteService.createWithEmails(
      chapterId,
      userId,
      dto.role,
      dto.emails,
    );
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary:
      "Read an invite's chapter, inviter and role without redeeming it (410 when the invite is dead)",
  })
  @ApiOkResponse({ type: InvitePreviewResponseDto })
  async preview(
    @Body() dto: PreviewInviteDto,
  ): Promise<InvitePreviewResponseDto> {
    return this.inviteService.preview(dto.token);
  }

  @Post('redeem')
  @ThrottleFanOutWrite()
  @ApiOperation({ summary: 'Redeem an invite token to join a chapter' })
  @FeatureEvent('invite-redeemed', undefined, {
    chapterId: ({
      result,
    }: FeatureEventInput<RedeemInviteDto, { chapterId: string }>) =>
      result.chapterId,
  })
  async redeem(
    @CurrentUser('id') userId: string,
    @Body() dto: RedeemInviteDto,
  ) {
    return this.inviteService.redeem(
      dto.token,
      userId,
      dto.accept_terms_privacy === true,
    );
  }

  @Get()
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @ApiOperation({ summary: 'List chapter invites' })
  async list(@CurrentChapterId() chapterId: string) {
    return this.inviteService.findByChapter(chapterId);
  }

  @Delete(':id')
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @ApiOperation({ summary: 'Revoke an invite' })
  async revoke(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    await this.inviteService.revoke(id, chapterId);
    return { success: true };
  }
}

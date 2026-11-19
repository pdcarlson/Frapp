import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
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
  ThrottlePersonalNudge,
} from '../decorators/throttle-profiles.decorator';
import {
  CurrentUser,
  CurrentChapterId,
  CurrentVerifiedEmail,
} from '../decorators/current-user.decorator';
import {
  CreateInviteDto,
  BatchCreateInvitesDto,
  BulkEmailInviteDto,
  RedeemInviteDto,
  PreviewInviteDto,
  InvitePreviewResponseDto,
  InviteListItemDto,
  BulkEmailInviteResponseDto,
  PendingInviteDto,
  InvitableRolesDto,
  ChapterLinkResponseDto,
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
  @ApiCreatedResponse({ type: InviteListItemDto })
  @FeatureEvent('invite-created', () => ({ invite_method: 'link', count: 1 }))
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateInviteDto,
  ): Promise<InviteListItemDto> {
    return this.inviteService.create(chapterId, userId, dto.role);
  }

  @Get('chapter-link')
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @ApiOperation({
    summary: "The chapter's shareable invite link, if it has one (#3353)",
    description:
      'One link many people join with, at the chapter default invite role, for 7 days. Turn it off with DELETE /v1/invites/:id.',
  })
  @ApiOkResponse({ type: ChapterLinkResponseDto })
  async getChapterLink(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChapterLinkResponseDto> {
    return {
      link: await this.inviteService.findChapterLink(chapterId, userId),
    };
  }

  @Post('chapter-link')
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @GraceBlocked()
  @ApiOperation({
    summary:
      "Make the chapter's shareable invite link, turning off the one before it (#3353)",
    description:
      '403 when the current link grants a role above the caller (only a higher officer may replace it); 409 when another officer made one at the same moment.',
  })
  @ApiCreatedResponse({ type: InviteListItemDto })
  @FeatureEvent('invite-created', () => ({
    invite_method: 'chapter-link',
    count: 1,
  }))
  async createChapterLink(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<InviteListItemDto> {
    return this.inviteService.createChapterLink(chapterId, userId);
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
  @ApiCreatedResponse({ type: BulkEmailInviteResponseDto })
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
  ): Promise<BulkEmailInviteResponseDto> {
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

  @Post('ask-for-new-link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ThrottlePersonalNudge()
  @ApiOperation({
    summary: "Ask a dead invite's sender for a new link",
    description:
      'Notifies whoever sent the invite, by name, that the caller wants a new link (#5625). 409 when the invite still works or the caller is already in the chapter; 404 for an unknown invite.',
  })
  @ApiNoContentResponse()
  async askForNewLink(
    @CurrentUser('id') userId: string,
    @Body() dto: PreviewInviteDto,
  ): Promise<void> {
    await this.inviteService.askForNewLink(dto.token, userId);
  }

  @Post('redeem')
  @ThrottleFanOutWrite()
  @ApiOperation({ summary: 'Redeem an invite token to join a chapter' })
  @FeatureEvent(
    'invite-redeemed',
    ({ signInMethod }: FeatureEventInput) => ({
      sign_in_method: signInMethod ?? null,
    }),
    {
      chapterId: ({
        result,
      }: FeatureEventInput<RedeemInviteDto, { chapterId: string }>) =>
        result.chapterId,
    },
  )
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

  /**
   * No chapter guard: the caller may belong to no chapter yet, and the read is
   * scoped by their verified address, not by a chapter (#3776).
   */
  @Get('mine')
  @ApiOperation({
    summary:
      "Pending invites emailed to the caller's verified address, with their tokens",
  })
  @ApiOkResponse({ type: PendingInviteDto, isArray: true })
  async listMine(
    @CurrentUser('id') userId: string,
    @CurrentVerifiedEmail() verifiedEmail: string | null,
  ): Promise<PendingInviteDto[]> {
    return this.inviteService.findPendingForVerifiedEmail(
      verifiedEmail,
      userId,
    );
  }

  @Get('roles')
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @ApiOperation({
    summary: 'The roles the caller may invite someone into',
    description:
      'Roles ranked below the caller whose permissions they hold, never one carrying `*` (#4071, #4546, #1830). The Everyone role is always among them for a caller who may invite. The invite dialog offers only these; POST /v1/invites refuses the rest.',
  })
  @ApiOkResponse({ type: InvitableRolesDto })
  async listInvitableRoles(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<InvitableRolesDto> {
    return {
      role_ids: await this.inviteService.findInvitableRoleIds(
        chapterId,
        userId,
      ),
    };
  }

  @Get()
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @ApiOperation({
    summary: 'List chapter invites, newest first',
    description:
      'Only invites granting a role the caller could invite someone into now (#4546): ranked below them, carrying only permissions they hold. The rest are left out. A `*` holder gets every invite.',
  })
  @ApiOkResponse({ type: InviteListItemDto, isArray: true })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<InviteListItemDto[]> {
    return this.inviteService.findByChapter(chapterId, userId);
  }

  @Delete(':id')
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @ApiOperation({
    summary: 'Revoke an invite',
    description:
      'Not found (404) for an invite the list leaves out for the caller (#4546).',
  })
  async revoke(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.inviteService.revoke(id, chapterId, userId);
    return { success: true };
  }
}

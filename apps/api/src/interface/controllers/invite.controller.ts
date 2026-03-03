import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { InviteService } from '../../application/services/invite.service';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentUser,
  CurrentChapterId,
} from '../decorators/current-user.decorator';
import {
  CreateInviteDto,
  BatchCreateInvitesDto,
  RedeemInviteDto,
} from '../dtos/invite.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Invites')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@UseInterceptors(AuthSyncInterceptor)
@Controller('invites')
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  @Post()
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @ApiOperation({ summary: 'Generate an invite token' })
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateInviteDto,
  ) {
    return this.inviteService.create(chapterId, userId, dto.role);
  }

  @Post('batch')
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_INVITE)
  @ApiOperation({ summary: 'Generate multiple invite tokens' })
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

  @Post('redeem')
  @ApiOperation({ summary: 'Redeem an invite token to join a chapter' })
  async redeem(
    @CurrentUser('id') userId: string,
    @Body() dto: RedeemInviteDto,
  ) {
    return this.inviteService.redeem(dto.token, userId);
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

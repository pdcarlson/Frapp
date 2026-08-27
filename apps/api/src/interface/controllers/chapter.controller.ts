import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { ChapterService } from '../../application/services/chapter.service';
import { ChapterOnboardingService } from '../../application/services/chapter-onboarding.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import {
  RequireAnyOfPermissions,
  RequirePermissions,
} from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import {
  CurrentUser,
  CurrentChapterId,
} from '../decorators/current-user.decorator';
import {
  CreateChapterDto,
  UpdateChapterDto,
  LogoUploadUrlDto,
  ConfirmLogoDto,
} from '../dtos/chapter.dto';
import { ChapterOnboardingDto } from '../dtos/chapter-onboarding.dto';
import { CurrentChapterResponseDto } from '../dtos/chapter-response.dto';
import { toChapterMemberView } from '../../application/services/chapter-member-view';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Chapters')
@ApiBearerAuth()
@FreeTier()
@Controller('chapters')
export class ChapterController {
  constructor(
    private readonly chapterService: ChapterService,
    private readonly chapterOnboardingService: ChapterOnboardingService,
  ) {}

  @Post()
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(AuthSyncInterceptor)
  @ApiOperation({ summary: 'Create a new chapter' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateChapterDto,
  ) {
    return this.chapterService.create(userId, dto);
  }

  @Post('onboard')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(AuthSyncInterceptor)
  @ApiOperation({
    summary:
      'Create and configure a chapter from the onboarding wizard (archetype, branding, default channels, welcome message)',
  })
  async onboard(
    @CurrentUser('id') userId: string,
    @Body() dto: ChapterOnboardingDto,
  ) {
    return this.chapterOnboardingService.onboard(userId, dto);
  }

  @Get()
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(AuthSyncInterceptor)
  @ApiOperation({ summary: 'List chapters for current user' })
  async listForCurrentUser(@CurrentUser('id') userId: string) {
    return this.chapterService.listForUser(userId);
  }

  @Post(':id/activate')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(AuthSyncInterceptor)
  @ApiOperation({
    summary:
      'Set the active chapter for the current user (embedded in subsequent access tokens)',
  })
  async activate(
    @CurrentUser('id') userId: string,
    @Param('id') chapterId: string,
  ) {
    await this.chapterService.setActiveChapter(userId, chapterId);
    // The claim is only refreshed when a token is issued, so the client must
    // call supabase.auth.refreshSession() before its next request for the new
    // chapter to take effect ahead of the current token's expiry.
    return { success: true, requires_session_refresh: true };
  }

  @Get('current')
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({
    summary: 'Get current chapter (includes a signed logo_url when one is set)',
  })
  // Guarded by `members:view`, i.e. every member — so the payload is the
  // member-safe projection, never the raw row (#930).
  @ApiOkResponse({ type: CurrentChapterResponseDto })
  async getCurrent(@CurrentChapterId() chapterId: string) {
    return this.chapterService.findByIdWithLogoUrl(chapterId);
  }

  @Patch('current')
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @RequireAnyOfPermissions(
    SystemPermissions.ROLES_MANAGE,
    SystemPermissions.BILLING_MANAGE,
  )
  @ApiOperation({ summary: 'Update current chapter settings' })
  async update(
    @CurrentChapterId() chapterId: string,
    @Body() dto: UpdateChapterDto,
  ) {
    // Projected for the same reason `getCurrent` is (#930), and not only for
    // symmetry: this route admits `roles:manage` **or** `billing:manage`, so a
    // custom role carrying `roles:manage` without `billing:view` would
    // otherwise read the billing identifiers straight out of the write
    // response. The client discards this body and refetches, so narrowing it
    // costs nothing.
    return toChapterMemberView(
      await this.chapterService.update(chapterId, dto),
    );
  }

  @Post('current/logo-url')
  @ThrottleFanOutWrite()
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @RequireAnyOfPermissions(
    SystemPermissions.ROLES_MANAGE,
    SystemPermissions.BILLING_MANAGE,
  )
  @ApiOperation({ summary: 'Generate signed upload URL for chapter logo' })
  async requestLogoUploadUrl(
    @CurrentChapterId() chapterId: string,
    @Body() dto: LogoUploadUrlDto,
  ) {
    return this.chapterService.requestLogoUploadUrl(
      chapterId,
      dto.filename,
      dto.content_type,
    );
  }

  @Post('current/logo')
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @RequireAnyOfPermissions(
    SystemPermissions.ROLES_MANAGE,
    SystemPermissions.BILLING_MANAGE,
  )
  @ApiOperation({ summary: 'Confirm logo upload and update chapter' })
  async confirmLogoUpload(
    @CurrentChapterId() chapterId: string,
    @Body() dto: ConfirmLogoDto,
  ) {
    return this.chapterService.confirmLogoUpload(chapterId, dto.storage_path);
  }

  @Delete('current/logo')
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @RequireAnyOfPermissions(
    SystemPermissions.ROLES_MANAGE,
    SystemPermissions.BILLING_MANAGE,
  )
  @ApiOperation({ summary: 'Remove chapter logo' })
  async deleteLogo(@CurrentChapterId() chapterId: string) {
    return this.chapterService.deleteLogo(chapterId);
  }
}

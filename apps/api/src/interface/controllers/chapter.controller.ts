import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { ChapterService } from '../../application/services/chapter.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import {
  RequireAnyOfPermissions,
  RequirePermissions,
} from '../decorators/permissions.decorator';
import { AuthSyncGuard } from '../guards/auth-sync.guard';
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
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Chapters')
@ApiBearerAuth()
@Controller('chapters')
export class ChapterController {
  constructor(private readonly chapterService: ChapterService) {}

  @Post()
  @UseGuards(SupabaseAuthGuard, AuthSyncGuard)
  @ApiOperation({ summary: 'Create a new chapter' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateChapterDto,
  ) {
    return this.chapterService.create(userId, dto);
  }

  @Get('current')
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({ summary: 'Get current chapter' })
  async getCurrent(@CurrentChapterId() chapterId: string) {
    return this.chapterService.findById(chapterId);
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
    return this.chapterService.update(chapterId, dto);
  }

  @Post('current/logo-url')
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

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChapterConfigService } from '../../application/services/chapter-config.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import {
  RequireAnyOfPermissions,
  RequirePermissions,
} from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import { PatchChapterConfigDto } from '../dtos/chapter-config.dto';

@ApiTags('Chapter Config')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.CHAPTER_CONFIG_VIEW)
@FreeTier()
@Controller('chapters')
export class ChapterConfigController {
  constructor(private readonly configService: ChapterConfigService) {}

  @Get(':id/config')
  @ApiOperation({
    summary: 'Get merged chapter config (archetype defaults + overrides)',
  })
  async getConfig(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    this.assertMatchesActiveChapter(id, chapterId);
    return this.configService.getConfig(chapterId);
  }

  @Patch(':id/config')
  @RequireAnyOfPermissions(
    SystemPermissions.CHAPTER_CONFIG_MANAGE,
    SystemPermissions.WILDCARD,
  )
  @ApiOperation({
    summary:
      'Update chapter config (writes audit log + posts to #chapter-audit)',
  })
  async patchConfig(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: PatchChapterConfigDto,
  ) {
    this.assertMatchesActiveChapter(id, chapterId);
    return this.configService.patchConfig(chapterId, userId, dto);
  }

  @Post(':id/theme-palette')
  @RequireAnyOfPermissions(
    SystemPermissions.CHAPTER_CONFIG_MANAGE,
    SystemPermissions.WILDCARD,
  )
  @ApiOperation({
    summary: 'Recompute and persist derived theme palette from branding.colors',
  })
  async recomputePalette(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    this.assertMatchesActiveChapter(id, chapterId);
    return this.configService.recomputeAndPersistPalette(chapterId);
  }

  /**
   * Every route on this controller takes a `:id` path segment purely for URL
   * consistency with the rest of the API — the guard-resolved `chapterId` is
   * what actually gets used. Left unchecked, `:id` disagreeing with it would
   * be a contract lie (200 on a chapter the caller didn't ask for) rather
   * than a leak (#866): reject the mismatch instead of silently ignoring it.
   */
  private assertMatchesActiveChapter(id: string, chapterId: string): void {
    if (id !== chapterId) {
      throw new ForbiddenException({
        code: 'chapter.context.mismatch',
        message:
          'The chapter id in the URL disagrees with your active chapter context.',
      });
    }
  }
}

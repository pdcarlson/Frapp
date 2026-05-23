import {
  Body,
  Controller,
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
@Controller('chapters')
export class ChapterConfigController {
  constructor(private readonly configService: ChapterConfigService) {}

  @Get(':id/config')
  @ApiOperation({
    summary: 'Get merged chapter config (archetype defaults + overrides)',
  })
  async getConfig(
    @Param('id') _id: string,
    @CurrentChapterId() chapterId: string,
  ) {
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
    @Param('id') _id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: PatchChapterConfigDto,
  ) {
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
    @Param('id') _id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.configService.recomputeAndPersistPalette(chapterId);
  }
}

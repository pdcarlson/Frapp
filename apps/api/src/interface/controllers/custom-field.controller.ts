import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CustomFieldService } from '../../application/services/custom-field.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import { CustomFieldDto } from '../dtos/custom-field.dto';

/**
 * Read-only access to the chapter's custom-field *definitions* (the full set,
 * including higher-tier/sensitive fields), so the read gate matches the shipped
 * custom-roles read: `chapter-config:view`. This backs the Settings → Fields tab
 * (#539, which adds POST/PATCH/DELETE here later). The member directory does NOT
 * use this — it renders a member's values from `GET /members/:id`, which
 * tier-filters per viewer; exposing every definition's label here would leak the
 * existence of president/sensitive fields to baseline members.
 */
@ApiTags('Chapter Custom Fields')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.CHAPTER_CONFIG_VIEW)
@FreeTier()
@Controller('custom-fields')
export class CustomFieldController {
  constructor(private readonly customFieldService: CustomFieldService) {}

  @Get()
  @ApiOperation({ summary: 'List the chapter custom-field definitions' })
  @ApiOkResponse({ type: CustomFieldDto, isArray: true })
  async list(@CurrentChapterId() chapterId: string) {
    return this.customFieldService.findByChapter(chapterId);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CustomFieldService } from '../../application/services/custom-field.service';
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
import {
  CreateCustomFieldDto,
  CustomFieldDto,
  RemoveCustomFieldResponseDto,
  UpdateCustomFieldDto,
} from '../dtos/custom-field.dto';

/**
 * Settings → Fields. CRUD over `chapter_custom_fields`. Reads require
 * `chapter-config:view`; writes require `chapter-config:manage` (or wildcard),
 * matching the rest of the settings surface. Every write is audit-logged.
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
  @ApiOperation({ summary: 'List the chapter custom fields' })
  @ApiOkResponse({ type: CustomFieldDto, isArray: true })
  async list(@CurrentChapterId() chapterId: string) {
    return this.customFieldService.findByChapter(chapterId);
  }

  @Post()
  @RequireAnyOfPermissions(
    SystemPermissions.CHAPTER_CONFIG_MANAGE,
    SystemPermissions.WILDCARD,
  )
  @ApiOperation({ summary: 'Create a custom field (audit-logged)' })
  @ApiCreatedResponse({ type: CustomFieldDto })
  @ApiConflictResponse({
    description: 'A custom field with this key already exists in this chapter',
  })
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCustomFieldDto,
  ) {
    return this.customFieldService.create(chapterId, userId, dto);
  }

  @Patch(':id')
  @RequireAnyOfPermissions(
    SystemPermissions.CHAPTER_CONFIG_MANAGE,
    SystemPermissions.WILDCARD,
  )
  @ApiOperation({ summary: 'Update a custom field (audit-logged)' })
  @ApiOkResponse({ type: CustomFieldDto })
  async update(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCustomFieldDto,
  ) {
    return this.customFieldService.update(id, chapterId, userId, dto);
  }

  @Delete(':id')
  @RequireAnyOfPermissions(
    SystemPermissions.CHAPTER_CONFIG_MANAGE,
    SystemPermissions.WILDCARD,
  )
  @ApiOperation({ summary: 'Delete a custom field (audit-logged)' })
  @ApiOkResponse({ type: RemoveCustomFieldResponseDto })
  async remove(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.customFieldService.remove(id, chapterId, userId);
  }
}

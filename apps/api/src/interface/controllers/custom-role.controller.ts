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
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CustomRoleService } from '../../application/services/custom-role.service';
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
  CreateCustomRoleDto,
  CustomRoleDto,
  RemoveCustomRoleResponseDto,
  UpdateCustomRoleDto,
} from '../dtos/custom-role.dto';

/**
 * Settings → Roles → Custom. CRUD over `chapter_custom_roles`. Reads require
 * `chapter-config:view`; writes require `chapter-config:manage` (or wildcard),
 * matching the rest of the settings surface. Every write is audit-logged.
 */
@ApiTags('Chapter Custom Roles')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.CHAPTER_CONFIG_VIEW)
@FreeTier()
@Controller('custom-roles')
export class CustomRoleController {
  constructor(private readonly customRoleService: CustomRoleService) {}

  @Get()
  @ApiOperation({ summary: 'List the chapter custom roles' })
  @ApiOkResponse({ type: CustomRoleDto, isArray: true })
  async list(@CurrentChapterId() chapterId: string) {
    return this.customRoleService.findByChapter(chapterId);
  }

  @Post()
  @RequireAnyOfPermissions(
    SystemPermissions.CHAPTER_CONFIG_MANAGE,
    SystemPermissions.WILDCARD,
  )
  @ApiOperation({ summary: 'Create a custom role (audit-logged)' })
  @ApiCreatedResponse({ type: CustomRoleDto })
  @ApiConflictResponse({
    description: 'A custom role with this key already exists in this chapter',
  })
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCustomRoleDto,
  ) {
    return this.customRoleService.create(chapterId, userId, dto);
  }

  @Patch(':id')
  @RequireAnyOfPermissions(
    SystemPermissions.CHAPTER_CONFIG_MANAGE,
    SystemPermissions.WILDCARD,
  )
  @ApiOperation({ summary: 'Update a custom role (audit-logged)' })
  @ApiOkResponse({ type: CustomRoleDto })
  async update(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCustomRoleDto,
  ) {
    return this.customRoleService.update(id, chapterId, userId, dto);
  }

  @Delete(':id')
  @RequireAnyOfPermissions(
    SystemPermissions.CHAPTER_CONFIG_MANAGE,
    SystemPermissions.WILDCARD,
  )
  @ApiOperation({
    summary: 'Delete a non-core custom role (audit-logged)',
  })
  @ApiOkResponse({ type: RemoveCustomRoleResponseDto })
  @ApiForbiddenResponse({ description: 'Core roles cannot be deleted' })
  async remove(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.customRoleService.remove(id, chapterId, userId);
  }
}

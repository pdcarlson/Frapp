import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RoleTierService } from '../../application/services/role-tier.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  CreateRoleTierDto,
  ReorderRoleTiersDto,
  RoleTierDto,
  UpdateRoleTierDto,
} from '../dtos/rbac.dto';
import { SystemPermissions } from '#domain/constants/permissions';

/**
 * A chapter's tiers of roles (#4071). Reading them takes `members:view`, as
 * reading roles does; every write takes `roles:manage` and the rank rules in
 * `RoleTierService`.
 */
@ApiTags('Roles & Permissions')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('role-tiers')
export class RoleTierController {
  constructor(private readonly tiers: RoleTierService) {}

  @Get()
  @ApiOperation({ summary: "List the chapter's role tiers, highest first" })
  @ApiOkResponse({ type: RoleTierDto, isArray: true })
  async list(@CurrentChapterId() chapterId: string) {
    return this.tiers.list(chapterId);
  }

  @Post()
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  @ApiOperation({
    summary: 'Add a role tier',
    description:
      'Added at the bottom, below every other tier, with only permissions the caller holds.',
  })
  @ApiCreatedResponse({ type: RoleTierDto })
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRoleTierDto,
  ) {
    return this.tiers.create(chapterId, userId, dto);
  }

  // Declared before `:id` so `order` is never read as a tier id.
  @Put('order')
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  @ApiOperation({
    summary: 'Reorder the role tiers',
    description:
      "Every tier, highest first. Tiers from the top down to the caller's own stay where they are; 409 when the tiers changed since the caller read them.",
  })
  @ApiOkResponse({ type: RoleTierDto, isArray: true })
  async reorder(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ReorderRoleTiersDto,
  ) {
    return this.tiers.reorder(chapterId, userId, dto.tier_ids);
  }

  @Patch(':id')
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  @ApiOperation({
    summary: 'Rename a role tier or set its permissions',
    description:
      "Only a tier ranked below the caller's own. A new permission list rewrites every role in the tier, each with its own overrides applied.",
  })
  @ApiOkResponse({ type: RoleTierDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateRoleTierDto,
  ) {
    return this.tiers.update(id, chapterId, userId, dto);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  @ApiOperation({
    summary: 'Delete an empty role tier',
    description:
      "Only a tier ranked below the caller's own; 409 while a role still sits in it.",
  })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.tiers.delete(id, chapterId, userId);
    return { success: true };
  }
}

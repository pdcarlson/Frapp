import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentMember,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  CreateRoleDto,
  UpdateRoleDto,
  TransferPresidencyDto,
  PresidencyClaimStatusDto,
  PermissionCatalogEntryDto,
  SelfAssignRoleResultDto,
} from '../dtos/rbac.dto';
import { SystemPermissions } from '#domain/constants/permissions';

@ApiTags('Roles & Permissions')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('roles')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get()
  @ApiOperation({ summary: 'List chapter roles' })
  async list(@CurrentChapterId() chapterId: string) {
    return this.rbacService.findByChapter(chapterId);
  }

  @Get('permissions-catalog')
  @ApiOperation({ summary: 'Get system permissions catalog' })
  @ApiOkResponse({ type: PermissionCatalogEntryDto, isArray: true })
  catalog(): PermissionCatalogEntryDto[] {
    return this.rbacService.getPermissionsCatalog();
  }

  @Post()
  @ApiOperation({
    summary: 'Create a custom role',
    description:
      "Into a tier ranked below the caller's own, or outside the tiers, holding only permissions the caller holds (#4071).",
  })
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRoleDto,
  ) {
    return this.rbacService.createAsMember(chapterId, userId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a role',
    description:
      "Only a role ranked below the caller's own, and only granting permissions the caller holds (#4071). Send `permissions` (the whole list), or `tier_id` and `permission_overrides`, not both.",
  })
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async update(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rbacService.updateAsMember(id, chapterId, userId, dto);
  }

  // Behind the controller's `members:view` only: any member joins and leaves
  // a role an officer marked self-assignable (#4958). The service refuses
  // every other role, whatever the caller holds.
  @Post(':id/join')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Join a self-assignable role',
    description:
      "Adds the role to the caller's own roles (#4958). 403 `role.not_self_assignable` unless an officer marked it and it is still safe to pick; 409 when it changed mid-save. Joining a role already held changes nothing.",
  })
  @ApiOkResponse({ type: SelfAssignRoleResultDto })
  async join(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<SelfAssignRoleResultDto> {
    return this.rbacService.setOwnSelfAssignableRole(
      chapterId,
      userId,
      id,
      true,
    );
  }

  @Post(':id/leave')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Leave a self-assignable role',
    description:
      "Takes the role off the caller's own roles (#4958), with the same refusals as join. Leaving a role not held changes nothing.",
  })
  @ApiOkResponse({ type: SelfAssignRoleResultDto })
  async leave(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<SelfAssignRoleResultDto> {
    return this.rbacService.setOwnSelfAssignableRole(
      chapterId,
      userId,
      id,
      false,
    );
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a custom role',
    description: "Only a role ranked below the caller's own (#4071).",
  })
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async delete(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.rbacService.deleteAsMember(id, chapterId, userId);
    return { success: true };
  }

  @Post('transfer-presidency')
  @RequirePermissions(SystemPermissions.WILDCARD)
  @ApiOperation({ summary: 'Transfer presidency to another member' })
  async transferPresidency(
    @CurrentChapterId() chapterId: string,
    @CurrentMember() member: { id: string },
    @Body() dto: TransferPresidencyDto,
  ) {
    await this.rbacService.transferPresidency(
      chapterId,
      member.id,
      dto.target_member_id,
    );
    return { success: true };
  }

  // No RequirePermissions beyond the controller-level `members:view`: the
  // eligible claimant is by definition not the (now-vacant) President and is
  // often not a `roles:manage` holder either, so this must be readable by
  // every chapter member — the service enforces actual eligibility.
  @Get('presidency-claim-status')
  @ApiOperation({
    summary: "Whether the caller may claim the chapter's vacant presidency",
  })
  @ApiOkResponse({ type: PresidencyClaimStatusDto })
  async presidencyClaimStatus(
    @CurrentChapterId() chapterId: string,
    @CurrentMember() member: { id: string },
  ) {
    return this.rbacService.getPresidencyClaimStatus(chapterId, member.id);
  }

  @Post('claim-presidency')
  @ApiOperation({ summary: "Claim the chapter's vacant presidency" })
  async claimPresidency(
    @CurrentChapterId() chapterId: string,
    @CurrentMember() member: { id: string },
  ) {
    await this.rbacService.claimPresidency(chapterId, member.id);
    return { success: true };
  }
}

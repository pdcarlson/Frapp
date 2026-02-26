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
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentMember,
} from '../decorators/current-user.decorator';
import {
  CreateRoleDto,
  UpdateRoleDto,
  TransferPresidencyDto,
} from '../dtos/rbac.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Roles & Permissions')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
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
  async catalog() {
    return this.rbacService.getPermissionsCatalog();
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom role' })
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async create(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateRoleDto,
  ) {
    return this.rbacService.create(chapterId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a role' })
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rbacService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a custom role' })
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async delete(@Param('id') id: string) {
    await this.rbacService.delete(id);
    return { success: true };
  }

  @Post('transfer-presidency')
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
}

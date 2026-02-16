import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiHeader,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RbacService } from '../../application/services/rbac.service';
import { CreateRoleDto, RoleResponseDto } from '../dtos/rbac.dto';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { PERMISSIONS } from '../../domain/constants/permissions';

@ApiTags('RBAC')
@Controller('rbac')
@UseGuards(ClerkAuthGuard, ChapterGuard, PermissionsGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'x-chapter-id', required: true })
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Post('roles')
  @ApiOperation({ summary: 'Create a new custom role' })
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ApiResponse({ status: 201, type: RoleResponseDto })
  async createRole(
    @Headers('x-chapter-id') chapterId: string,
    @Body() dto: CreateRoleDto,
  ) {
    return this.rbacService.createRole(chapterId, dto.name, dto.permissions);
  }

  @Get('roles')
  @ApiOperation({ summary: 'List all roles for the chapter' })
  @ApiResponse({ status: 200, type: [RoleResponseDto] })
  async getRoles(@Headers('x-chapter-id') chapterId: string) {
    return this.rbacService.getRolesForChapter(chapterId);
  }

  @Get('permissions')
  @ApiOperation({ summary: 'List all available permissions' })
  @ApiResponse({ status: 200, type: [String] })
  getPermissions() {
    return Object.values(PERMISSIONS);
  }
}

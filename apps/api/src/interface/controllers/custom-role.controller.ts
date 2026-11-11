import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { CustomRoleDto } from '../dtos/custom-role.dto';

/**
 * Kept only for the mobile builds already in the stores (#4075). Custom roles
 * were folded into ordinary roles by migration `20261111200000`, so this
 * always answers an empty list. Every shipped build's member sheet calls it
 * (`useCustomRoles`) and treats an empty list as "no custom roles"; a 404 would
 * fail the shipped-contract check. Delete it, with `custom_role_ids` on member
 * responses, once production's minimum mobile version is above every build
 * that calls it (#4194).
 */
@ApiTags('Chapter Custom Roles')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.CHAPTER_CONFIG_VIEW)
@FreeTier()
@Controller('custom-roles')
export class CustomRoleController {
  @Get()
  @ApiOperation({
    summary: 'Deprecated: always empty (custom roles are ordinary roles now)',
    deprecated: true,
  })
  @ApiOkResponse({ type: CustomRoleDto, isArray: true })
  list(): CustomRoleDto[] {
    return [];
  }
}

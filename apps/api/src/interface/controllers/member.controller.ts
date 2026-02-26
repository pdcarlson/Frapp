import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { MemberService } from '../../application/services/member.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentMember,
} from '../decorators/current-user.decorator';
import { UpdateMemberRolesDto, UpdateOnboardingDto } from '../dtos/member.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Members')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@Controller('members')
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Get()
  @ApiOperation({ summary: 'List chapter members' })
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  async list(@CurrentChapterId() chapterId: string) {
    return this.memberService.findByChapter(chapterId);
  }

  @Patch(':id/roles')
  @ApiOperation({ summary: 'Update member roles' })
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async updateRoles(
    @Param('id') id: string,
    @Body() dto: UpdateMemberRolesDto,
  ) {
    return this.memberService.updateRoles(id, dto.role_ids);
  }

  @Patch('me/onboarding')
  @ApiOperation({ summary: 'Update onboarding status' })
  async updateOnboarding(
    @CurrentMember() member: { id: string },
    @Body() dto: UpdateOnboardingDto,
  ) {
    return this.memberService.updateOnboarding(
      member.id,
      dto.has_completed_onboarding,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove member from chapter' })
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_REMOVE)
  async remove(@Param('id') id: string) {
    await this.memberService.remove(id);
    return { success: true };
  }
}

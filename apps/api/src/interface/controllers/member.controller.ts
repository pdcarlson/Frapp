import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
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

  @Get('search')
  @ApiOperation({ summary: 'Search members by name' })
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiQuery({ name: 'q', required: true, description: 'Search query (name)' })
  async search(
    @CurrentChapterId() chapterId: string,
    @Query('q') query: string,
  ) {
    return this.memberService.searchByChapterAndName(chapterId, query ?? '');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get member profile by ID' })
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  async getOne(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    return this.memberService.findProfileById(id, chapterId);
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

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
import { ChapterGroupService } from '../../application/services/chapter-group.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  ChapterGroupDto,
  CreateChapterGroupDto,
  SetChapterGroupMembersDto,
  UpdateChapterGroupDto,
} from '../dtos/chapter-group.dto';

/**
 * A chapter's groups (#4076): named sets of members with no permissions,
 * to `@`-mention and to name in a channel's who-can-see and who-can-post
 * lists.
 *
 * Reads need `members:view`, like the Directory that shows a member's
 * groups. Writes need `groups:manage`, which is lighter than `roles:manage`:
 * a group grants nothing. `@FreeTier()` because the Directory is a free
 * module (`MemberController` carries the same).
 */
@ApiTags('Groups')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('groups')
export class ChapterGroupController {
  constructor(private readonly groups: ChapterGroupService) {}

  @Get()
  @ApiOperation({
    summary:
      "List the chapter's groups with their members: manual ones, then pledge classes and class years that have members",
  })
  @ApiOkResponse({ type: ChapterGroupDto, isArray: true })
  async list(@CurrentChapterId() chapterId: string) {
    return this.groups.list(chapterId);
  }

  @Post()
  @ApiOperation({ summary: 'Make a group and, optionally, pick its members' })
  @ApiCreatedResponse({ type: ChapterGroupDto })
  @RequirePermissions(SystemPermissions.GROUPS_MANAGE)
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateChapterGroupDto,
  ) {
    return this.groups.create(chapterId, userId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      "Rename a group, recolor it, or switch whether anyone can ping it. An automatic group's name can't change.",
  })
  @ApiOkResponse({ type: ChapterGroupDto })
  @RequirePermissions(SystemPermissions.GROUPS_MANAGE)
  async update(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChapterGroupDto,
  ) {
    return this.groups.update(id, chapterId, userId, dto);
  }

  @Put(':id/members')
  @ApiOperation({ summary: "Set a manual group's whole member list" })
  @ApiOkResponse({ type: ChapterGroupDto })
  @RequirePermissions(SystemPermissions.GROUPS_MANAGE)
  async setMembers(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetChapterGroupMembersDto,
  ) {
    return this.groups.setMembers(id, chapterId, userId, dto.member_ids);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Delete a manual group; channel lists that named it lose the entry',
  })
  @RequirePermissions(SystemPermissions.GROUPS_MANAGE)
  async remove(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.groups.remove(id, chapterId, userId);
    return { success: true };
  }
}

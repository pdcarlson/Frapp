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
  ApiOkResponse,
} from '@nestjs/swagger';
import { MemberService } from '../../application/services/member.service';
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
  DismissOpsNudgeDto,
  UpdateMemberRolesDto,
  UpdateOnboardingDto,
} from '../dtos/member.dto';
import {
  MemberProfileDto,
  MemberRosterEntryDto,
} from '../dtos/member-profile.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Members')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('members')
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Get()
  @ApiOperation({ summary: 'List chapter members' })
  @ApiOkResponse({ type: MemberProfileDto, isArray: true })
  async list(@CurrentChapterId() chapterId: string) {
    return this.memberService.findProfilesByChapter(chapterId);
  }

  // MUST stay above `@Get(':id')`. Nest matches routes in declaration order and
  // a single-segment `:id` would otherwise swallow this path, resolving it as
  // `getOne('search')` and answering 404 for a route that exists.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('search')
  @ApiOperation({ summary: 'Search members by name' })
  @ApiQuery({ name: 'q', required: true, description: 'Search query (name)' })
  @ApiOkResponse({ type: MemberProfileDto, isArray: true })
  async search(
    @CurrentChapterId() chapterId: string,
    @Query('q') query: string,
    @CurrentUser('id') viewerUserId: string,
  ) {
    return this.memberService.searchByChapterAndName(
      chapterId,
      query ?? '',
      viewerUserId,
    );
  }

  // MUST stay above `@Get(':id')`. Nest matches routes in declaration order and
  // a single-segment `:id` would otherwise swallow this path, resolving it as
  // `getOne('roster')` and answering 404 for a route that exists.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('roster')
  @ApiOperation({
    summary: 'Display roster for the chapter — id, name and avatar only',
  })
  @ApiOkResponse({ type: MemberRosterEntryDto, isArray: true })
  async roster(@CurrentChapterId() chapterId: string) {
    return this.memberService.findRosterByChapter(chapterId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get member profile by ID' })
  @ApiOkResponse({ type: MemberProfileDto })
  async getOne(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') viewerUserId: string,
    @Param('id') id: string,
  ) {
    return this.memberService.findProfileById(id, chapterId, viewerUserId);
  }

  @Patch(':id/roles')
  @ApiOperation({ summary: 'Update member roles' })
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async updateRoles(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMemberRolesDto,
  ) {
    return this.memberService.updateRoles(
      id,
      dto.role_ids,
      chapterId,
      dto.custom_role_ids,
    );
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

  /**
   * Dismiss one ops-setup nudge for the caller in the active chapter (#492).
   *
   * Carries no *handler-level* `@RequirePermissions`, matching `me/onboarding`
   * directly above. It is not unauthenticated or unpermissioned: `PermissionsGuard`
   * unions the handler and class lists, so this route inherits the controller's
   * class-level `@RequirePermissions(MEMBERS_VIEW)` and requires `members:view`,
   * resolved against the caller's own roles re-scoped by `chapter_id`.
   *
   * That a *write* rides a read permission is deliberate and is the same exception
   * `me/onboarding` takes: both write only the caller's own row through
   * `@CurrentMember()`, which `ChapterGuard` resolves filtered by both `user_id`
   * and `chapter_id`, so there is no id to authorize against and nothing a caller
   * could reach beyond their own membership. Recorded in
   * `docs/internal/security/AUTHORIZATION_MODEL.md` § Chapter-scoped controllers.
   *
   * Whether the member can *act* on the nudge is a separate question the client
   * answers — the card renders only behind `chapter-config:manage` — and
   * dismissing a card one cannot act on is a legitimate thing to want.
   */
  @Patch('me/ops-nudges/dismiss')
  @ApiOperation({ summary: 'Dismiss an ops-module setup nudge' })
  async dismissOpsNudge(
    @CurrentMember() member: { id: string },
    @Body() dto: DismissOpsNudgeDto,
  ) {
    return this.memberService.dismissOpsNudge(member.id, dto.module_key);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove member from chapter' })
  @RequirePermissions(SystemPermissions.MEMBERS_REMOVE)
  async remove(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.memberService.remove(id, chapterId, userId);
    return { success: true };
  }
}

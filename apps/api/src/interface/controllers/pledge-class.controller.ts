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
import { PledgeClassService } from '../../application/services/pledge-class.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  AssignPledgeClassesDto,
  MemberPledgeClassDto,
  PledgeClassDto,
  PledgeClassNameDto,
  ReorderPledgeClassesDto,
} from '../dtos/pledge-class.dto';

/**
 * A chapter's pledge classes and its members' class and order number (#3939).
 *
 * Reads need `members:view`, like the Directory that shows them. Every write
 * also needs `roles:manage`: the officers who already set a member's roles
 * are the ones who set their class. `@FreeTier()` because the Directory is a
 * free module (`MemberController` carries the same).
 */
@ApiTags('Pledge classes')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('pledge-classes')
export class PledgeClassController {
  constructor(private readonly pledgeClassService: PledgeClassService) {}

  @Get()
  @ApiOperation({ summary: "List the chapter's pledge classes, oldest first" })
  @ApiOkResponse({ type: PledgeClassDto, isArray: true })
  async list(@CurrentChapterId() chapterId: string) {
    return this.pledgeClassService.list(chapterId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a pledge class at the end of the list' })
  @ApiCreatedResponse({ type: PledgeClassDto })
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async create(
    @CurrentChapterId() chapterId: string,
    @Body() dto: PledgeClassNameDto,
  ) {
    return this.pledgeClassService.create(chapterId, dto.name);
  }

  // The two fixed paths are declared above `:id`, the order every controller
  // here keeps. Nothing can swallow them today: they are PUT, and the `:id`
  // routes are PATCH and DELETE.
  @Put('order')
  @ApiOperation({ summary: "Set the order of the chapter's pledge classes" })
  @ApiOkResponse({ type: PledgeClassDto, isArray: true })
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async reorder(
    @CurrentChapterId() chapterId: string,
    @Body() dto: ReorderPledgeClassesDto,
  ) {
    return this.pledgeClassService.reorder(chapterId, dto.ids);
  }

  @Put('assignments')
  @ApiOperation({
    summary: "Set members' pledge class and order number, all or none",
  })
  @ApiOkResponse({ type: MemberPledgeClassDto, isArray: true })
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async assign(
    @CurrentChapterId() chapterId: string,
    @Body() dto: AssignPledgeClassesDto,
  ) {
    return this.pledgeClassService.assign(chapterId, dto.assignments);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a pledge class' })
  @ApiOkResponse({ type: PledgeClassDto })
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async rename(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PledgeClassNameDto,
  ) {
    return this.pledgeClassService.rename(id, chapterId, dto.name);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Delete a pledge class; its members keep their order number and lose the class',
  })
  @RequirePermissions(SystemPermissions.ROLES_MANAGE)
  async remove(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.pledgeClassService.remove(id, chapterId);
    return { success: true };
  }
}

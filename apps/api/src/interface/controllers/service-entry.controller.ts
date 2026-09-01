import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ServiceEntryService } from '../../application/services/service-entry.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import {
  RequirePermissions,
  RequireAnyOfPermissions,
} from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  CreateServiceEntryDto,
  ListServiceEntriesQueryDto,
  RequestProofUploadUrlDto,
  ReviewServiceEntryDto,
  ServiceLeaderboardQueryDto,
} from '../dtos/service-entry.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Service Entries')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@RequireModule('hours')
@Controller('service-entries')
export class ServiceEntryController {
  constructor(
    private readonly serviceEntryService: ServiceEntryService,
    private readonly rbacService: RbacService,
  ) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({ summary: 'List service entries (own or all for admins)' })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListServiceEntriesQueryDto,
  ) {
    const isAdmin = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.SERVICE_APPROVE],
    );

    // Non-admins only ever see their own history, so their read is pinned to
    // their own id before any filter is applied — `userId` in the query string
    // can never widen it. Status and date filters still apply to that
    // narrowed set.
    return this.serviceEntryService.findByChapterFiltered(chapterId, {
      status: query.status,
      startDate: query.start_date,
      endDate: query.end_date,
      userId: isAdmin ? query.userId : userId,
    });
  }

  // Declared before `@Get(':id')`: Nest matches routes in declaration order,
  // so the param route would otherwise swallow `/leaderboard` and try to load
  // an entry with that id.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('leaderboard')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({
    summary: 'Chapter-wide service leaderboard (approved hours)',
    description:
      'Members ranked by total APPROVED service minutes, highest first. Optional inclusive date window filters on the service date; omitting both gives all-time.',
  })
  async leaderboard(
    @CurrentChapterId() chapterId: string,
    @Query() query: ServiceLeaderboardQueryDto,
  ) {
    return this.serviceEntryService.leaderboard(chapterId, {
      startDate: query.start_date,
      endDate: query.end_date,
    });
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({ summary: 'Get service entry by id' })
  async getOne(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    const entry = await this.serviceEntryService.findById(id, chapterId);
    const isAdmin = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.SERVICE_APPROVE],
    );
    if (entry.user_id !== userId && !isAdmin) {
      throw new ForbiddenException('Access denied to this service entry');
    }
    return entry;
  }

  @Post('proof-upload-url')
  @ThrottleFanOutWrite()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.SERVICE_LOG)
  @ApiOperation({ summary: 'Get signed upload URL for a service proof file' })
  async requestProofUploadUrl(
    @CurrentChapterId() chapterId: string,
    @Body() dto: RequestProofUploadUrlDto,
  ) {
    return this.serviceEntryService.requestProofUploadUrl({
      chapterId,
      filename: dto.filename,
      contentType: dto.content_type,
    });
  }

  @Get(':id/proof-url')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({
    summary: 'Get signed proof download URL (own entry or admins)',
  })
  async getProofUrl(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    const isAdmin = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.SERVICE_APPROVE],
    );
    return this.serviceEntryService.getProofDownloadUrl(
      id,
      chapterId,
      userId,
      isAdmin,
    );
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.SERVICE_LOG)
  @ApiOperation({ summary: 'Log a service entry' })
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateServiceEntryDto,
  ) {
    return this.serviceEntryService.create({
      chapter_id: chapterId,
      user_id: userId,
      date: dto.date,
      duration_minutes: dto.duration_minutes,
      description: dto.description,
      proof_path: dto.proof_path ?? null,
    });
  }

  @Patch(':id/review')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.SERVICE_APPROVE)
  @ApiOperation({ summary: 'Approve or reject a service entry' })
  async review(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') reviewerId: string,
    @Param('id') id: string,
    @Body() dto: ReviewServiceEntryDto,
  ) {
    if (dto.status === 'APPROVED') {
      return this.serviceEntryService.approve(
        id,
        chapterId,
        reviewerId,
        dto.review_comment,
      );
    }
    return this.serviceEntryService.reject(
      id,
      chapterId,
      reviewerId,
      dto.review_comment,
    );
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequireAnyOfPermissions(
    SystemPermissions.SERVICE_LOG,
    SystemPermissions.SERVICE_APPROVE,
  )
  @ApiOperation({
    summary: 'Delete a PENDING service entry (own or any for admins)',
  })
  async delete(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    const isAdmin = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.SERVICE_APPROVE],
    );
    await this.serviceEntryService.delete(id, chapterId, userId, isAdmin);
    return { success: true };
  }
}

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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ServiceEntryService } from '../../application/services/service-entry.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import {
  RequirePermissions,
  RequireAnyOfPermissions,
} from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  CreateServiceEntryDto,
  ReviewServiceEntryDto,
} from '../dtos/service-entry.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Service Entries')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@Controller('service-entries')
export class ServiceEntryController {
  constructor(
    private readonly serviceEntryService: ServiceEntryService,
    private readonly rbacService: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List service entries (own or all for admins)' })
  @ApiQuery({
    name: 'userId',
    required: false,
    description: 'Filter by user (admins with service:approve only)',
  })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query('userId') filterUserId?: string,
  ) {
    const isAdmin = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.SERVICE_APPROVE],
    );

    if (filterUserId && isAdmin) {
      return this.serviceEntryService.findByUser(chapterId, filterUserId);
    }
    if (isAdmin && !filterUserId) {
      return this.serviceEntryService.findByChapter(chapterId);
    }
    return this.serviceEntryService.findByUser(chapterId, userId);
  }

  @Get(':id')
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

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
import { CurrentChapterId } from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Alumni')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('alumni')
export class AlumniController {
  constructor(private readonly memberService: MemberService) {}

  @Get()
  @ApiOperation({ summary: 'List alumni members' })
  @ApiQuery({
    name: 'graduation_year',
    required: false,
    description: 'Filter by graduation year',
  })
  @ApiQuery({
    name: 'city',
    required: false,
    description: 'Filter by current city (partial match)',
  })
  @ApiQuery({
    name: 'company',
    required: false,
    description: 'Filter by current company (partial match)',
  })
  async list(
    @CurrentChapterId() chapterId: string,
    @Query('graduation_year') graduationYear?: string,
    @Query('city') city?: string,
    @Query('company') company?: string,
  ) {
    const filter: {
      graduation_year?: number;
      city?: string;
      company?: string;
    } = {};
    if (graduationYear !== undefined && graduationYear !== '') {
      const year = parseInt(graduationYear, 10);
      if (!isNaN(year)) filter.graduation_year = year;
    }
    if (city !== undefined && city !== '') filter.city = city;
    if (company !== undefined && company !== '') filter.company = company;

    return this.memberService.findAlumniByChapter(
      chapterId,
      Object.keys(filter).length > 0 ? filter : undefined,
    );
  }
}

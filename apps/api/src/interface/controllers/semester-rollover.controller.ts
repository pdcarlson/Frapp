import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SemesterRolloverService } from '../../application/services/semester-rollover.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import { RolloverDto } from '../dtos/semester-rollover.dto';

@ApiTags('Semesters')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller()
export class SemesterRolloverController {
  constructor(
    private readonly semesterRolloverService: SemesterRolloverService,
  ) {}

  @Post('chapters/current/rollover')
  @RequirePermissions(SystemPermissions.SEMESTER_ROLLOVER)
  @ApiOperation({ summary: 'Trigger semester rollover' })
  async rollover(
    @CurrentChapterId() chapterId: string,
    @Body() dto: RolloverDto,
  ) {
    return this.semesterRolloverService.rollover({
      chapterId,
      label: dto.label,
      startDate: dto.start_date,
      endDate: dto.end_date,
    });
  }

  @Get('semesters')
  @ApiOperation({ summary: 'List archived semesters' })
  async listSemesters(@CurrentChapterId() chapterId: string) {
    return this.semesterRolloverService.listSemesters(chapterId);
  }
}

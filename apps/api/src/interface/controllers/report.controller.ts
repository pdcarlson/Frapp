import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportService } from '../../application/services/report.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import {
  AttendanceReportDto,
  PointsReportDto,
  ServiceReportDto,
} from '../dtos/report.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.REPORTS_EXPORT)
@Controller('reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post('attendance')
  @ApiOperation({ summary: 'Generate attendance report data' })
  async attendance(
    @CurrentChapterId() chapterId: string,
    @Body() dto: AttendanceReportDto,
  ) {
    return this.reportService.getAttendanceReport(chapterId, {
      event_id: dto.event_id,
      start_date: dto.start_date,
      end_date: dto.end_date,
    });
  }

  @Post('points')
  @ApiOperation({ summary: 'Generate points report data' })
  async points(
    @CurrentChapterId() chapterId: string,
    @Body() dto: PointsReportDto,
  ) {
    return this.reportService.getPointsReport(chapterId, {
      user_id: dto.user_id,
      window: dto.window,
    });
  }

  @Post('roster')
  @ApiOperation({ summary: 'Generate member roster data' })
  async roster(@CurrentChapterId() chapterId: string) {
    return this.reportService.getRosterReport(chapterId);
  }

  @Post('service')
  @ApiOperation({ summary: 'Generate service hours report data' })
  async service(
    @CurrentChapterId() chapterId: string,
    @Body() dto: ServiceReportDto,
  ) {
    return this.reportService.getServiceReport(chapterId, {
      user_id: dto.user_id,
      start_date: dto.start_date,
      end_date: dto.end_date,
    });
  }
}

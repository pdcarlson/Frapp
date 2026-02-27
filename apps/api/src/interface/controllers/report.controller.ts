import { Body, Controller, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
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
import { toCSV } from '../../domain/utils/csv';
import {
  ATTENDANCE_COLUMNS,
  POINTS_COLUMNS,
  ROSTER_COLUMNS,
  SERVICE_COLUMNS,
} from './report-columns';

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
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.reportService.getAttendanceReport(chapterId, {
      event_id: dto.event_id,
      start_date: dto.start_date,
      end_date: dto.end_date,
    });
    if (format === 'csv') {
      res?.setHeader('Content-Type', 'text/csv');
      res?.setHeader(
        'Content-Disposition',
        'attachment; filename="attendance-report.csv"',
      );
      return toCSV(data, ATTENDANCE_COLUMNS);
    }
    return data;
  }

  @Post('points')
  @ApiOperation({ summary: 'Generate points report data' })
  async points(
    @CurrentChapterId() chapterId: string,
    @Body() dto: PointsReportDto,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.reportService.getPointsReport(chapterId, {
      user_id: dto.user_id,
      window: dto.window,
    });
    if (format === 'csv') {
      res?.setHeader('Content-Type', 'text/csv');
      res?.setHeader(
        'Content-Disposition',
        'attachment; filename="points-report.csv"',
      );
      return toCSV(data, POINTS_COLUMNS);
    }
    return data;
  }

  @Post('roster')
  @ApiOperation({ summary: 'Generate member roster data' })
  async roster(
    @CurrentChapterId() chapterId: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.reportService.getRosterReport(chapterId);
    if (format === 'csv') {
      res?.setHeader('Content-Type', 'text/csv');
      res?.setHeader(
        'Content-Disposition',
        'attachment; filename="roster-report.csv"',
      );
      return toCSV(data, ROSTER_COLUMNS);
    }
    return data;
  }

  @Post('service')
  @ApiOperation({ summary: 'Generate service hours report data' })
  async service(
    @CurrentChapterId() chapterId: string,
    @Body() dto: ServiceReportDto,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.reportService.getServiceReport(chapterId, {
      user_id: dto.user_id,
      start_date: dto.start_date,
      end_date: dto.end_date,
    });
    if (format === 'csv') {
      res?.setHeader('Content-Type', 'text/csv');
      res?.setHeader(
        'Content-Disposition',
        'attachment; filename="service-report.csv"',
      );
      return toCSV(data, SERVICE_COLUMNS);
    }
    return data;
  }
}

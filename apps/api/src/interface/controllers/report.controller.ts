import { Body, Controller, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOperation,
  ApiQuery,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportService } from '../../application/services/report.service';
import { ReportExportService } from '../../application/services/report-export.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import {
  AttendanceReportDto,
  PointsReportDto,
  ReportExportResponseDto,
  ServiceReportDto,
} from '../dtos/report.dto';
import { SystemPermissions } from '../../domain/constants/permissions';
import { toCSV } from '../../domain/utils/csv';
import { REPORT_COLUMNS, type ReportKind } from './report-columns';

const FORMAT_QUERY = {
  name: 'format',
  required: false,
  schema: { type: 'string' as const, enum: ['json', 'csv', 'pdf'] },
  description:
    'json (default) returns rows, csv returns an inline CSV body, pdf renders a branded document and returns a signed download URL.',
};

const EXPORT_RESPONSE = {
  description:
    'Report rows (json), an inline CSV body (csv), or a signed download envelope (pdf).',
  schema: {
    anyOf: [
      { $ref: getSchemaPath(ReportExportResponseDto) },
      { type: 'array' as const, items: { type: 'object' as const } },
      { type: 'string' as const },
    ],
  },
};

/** Join the non-empty parts of a report's scope line for the PDF header. */
function scopeLine(parts: (string | undefined)[]): string | undefined {
  const line = parts
    .filter((part): part is string => Boolean(part))
    .join(' · ');
  return line || undefined;
}

function dateRange(start?: string, end?: string): string | undefined {
  if (start && end) return `${start} – ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Through ${end}`;
  return 'All dates';
}

@ApiTags('Reports')
@ApiBearerAuth()
@ApiExtraModels(ReportExportResponseDto)
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.REPORTS_EXPORT)
@Controller('reports')
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly reportExportService: ReportExportService,
  ) {}

  @Post('attendance')
  @ApiOperation({ summary: 'Generate attendance report data' })
  @ApiQuery(FORMAT_QUERY)
  @ApiCreatedResponse(EXPORT_RESPONSE)
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
    return this.respond(chapterId, 'attendance', data, format, res, () =>
      scopeLine([
        dateRange(dto.start_date, dto.end_date),
        dto.event_id ? 'Single event' : 'All events',
      ]),
    );
  }

  @Post('points')
  @ApiOperation({ summary: 'Generate points report data' })
  @ApiQuery(FORMAT_QUERY)
  @ApiCreatedResponse(EXPORT_RESPONSE)
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
    return this.respond(chapterId, 'points', data, format, res, () =>
      scopeLine([
        `Window: ${dto.window ?? 'all'}`,
        dto.user_id ? 'Single member' : 'All members',
      ]),
    );
  }

  @Post('roster')
  @ApiOperation({ summary: 'Generate member roster data' })
  @ApiQuery(FORMAT_QUERY)
  @ApiCreatedResponse(EXPORT_RESPONSE)
  async roster(
    @CurrentChapterId() chapterId: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.reportService.getRosterReport(chapterId);
    return this.respond(chapterId, 'roster', data, format, res, () =>
      scopeLine(['Current members']),
    );
  }

  @Post('service')
  @ApiOperation({ summary: 'Generate service hours report data' })
  @ApiQuery(FORMAT_QUERY)
  @ApiCreatedResponse(EXPORT_RESPONSE)
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
    return this.respond(chapterId, 'service', data, format, res, () =>
      scopeLine([
        dateRange(dto.start_date, dto.end_date),
        dto.user_id ? 'Single member' : 'All members',
      ]),
    );
  }

  /**
   * Single dispatch point for the three export formats.
   *
   * CSV behaviour is byte-for-byte what it was before PDF existed — same
   * headers, same filename, same inline body. The dashboard does not use it
   * (it builds CSV client-side from the preview), so the contract is kept for
   * external callers, who are exactly the ones a silent change would break.
   * `subtitle` is a thunk so the scope line is only built when a PDF needs it.
   */
  private async respond<T extends Record<string, any>>(
    chapterId: string,
    kind: ReportKind,
    data: T[],
    format: string | undefined,
    res: Response | undefined,
    subtitle: () => string | undefined,
  ) {
    const columns = REPORT_COLUMNS[kind];

    if (format === 'pdf') {
      return this.reportExportService.exportPdf(
        chapterId,
        kind,
        columns,
        data,
        subtitle(),
      );
    }

    if (format === 'csv') {
      res?.setHeader('Content-Type', 'text/csv');
      res?.setHeader(
        'Content-Disposition',
        `attachment; filename="${kind}-report.csv"`,
      );
      return toCSV(data, columns);
    }

    return data;
  }
}

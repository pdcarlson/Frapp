import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
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
import {
  ReportService,
  type ReportResult,
} from '../../application/services/report.service';
import { ReportExportService } from '../../application/services/report-export.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import { ThrottleExpensiveWrite } from '../decorators/throttle-profiles.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import {
  AttendanceReportDto,
  PointsReportDto,
  ReportExportResponseDto,
  ServiceReportDto,
} from '../dtos/report.dto';
import { SystemPermissions } from '../../domain/constants/permissions';
import { toCSV } from '../../domain/utils/csv';
import {
  REPORT_COLUMNS,
  type ReportKind,
} from '../../domain/constants/report-columns';

/** Export formats every /v1/reports route accepts. Anything else is a 400. */
const REPORT_FORMATS = ['json', 'csv', 'pdf'];

/**
 * Set when a report's row ceiling cut it short.
 *
 * Truncation is signalled in headers rather than in the body because the `json`
 * body is a bare array and the `csv` body is consumed by parsers: wrapping
 * either in an envelope to carry one boolean would break every existing caller
 * — `packages/hooks/src/use-reports.ts`, the dashboard, and the generated SDK —
 * for a condition that a chapter-sized dataset should never reach. The `pdf`
 * format has an envelope already, so it carries the flag as a field *and*
 * prints it on the document.
 */
const TRUNCATED_HEADER = 'X-Report-Truncated';
const ROW_LIMIT_HEADER = 'X-Report-Row-Limit';
/**
 * Carries `ReportResult.note` — what was cut, when the row count does not say
 * it. Without this a roster whose *balances* were truncated would announce
 * itself with nothing but a row cap the document never reached, which reads as
 * a false positive on a report of the right length.
 */
const TRUNCATION_NOTE_HEADER = 'X-Report-Truncation-Note';

const FORMAT_QUERY = {
  name: 'format',
  required: false,
  schema: { type: 'string' as const, enum: REPORT_FORMATS },
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

/**
 * Reject an unrecognized format rather than quietly serving JSON. The contract
 * advertises an enum, and `format=PDF` silently returning rows instead of a
 * download envelope is a trap for an external caller with no error to notice.
 * Matches this endpoint family's existing stance on an unsupported points
 * `window` (spec/behavior/reports.md).
 *
 * Called before the report is read, not while responding: the read is now up
 * to dozens of sequential round-trips, and doing all of that only to reject
 * the request as malformed turns a typo into an expensive one — and a cheap
 * way to keep the API busy.
 */
function assertSupportedFormat(format: string | undefined): void {
  if (format !== undefined && !REPORT_FORMATS.includes(format)) {
    throw new BadRequestException(
      `Unsupported format "${format}". Expected one of: ${REPORT_FORMATS.join(', ')}.`,
    );
  }
}

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

/**
 * Make a note safe to put in an HTTP header.
 *
 * Node validates header content and **throws** on a byte outside the
 * latin1-ish set it accepts — the em dash in "balances are incomplete — summed
 * from…" is enough to do it. Unsanitized, announcing a truncated report would
 * crash the request instead: a 500 in place of a warning, which is strictly
 * worse than the silent truncation this all exists to fix.
 *
 * Typographic punctuation folds to its ASCII cousin and everything else is
 * dropped; collapsing whitespace first also means a CR or LF can never survive
 * into a header value.
 *
 * Only the header copy is flattened, and only `json`/`csv` callers read it —
 * the dashboard's preview and CSV warnings therefore show the ASCII form. The
 * PDF path carries the note in the response envelope instead, so the document
 * and its download toast keep the original typography.
 */
function toHeaderValue(note: string): string {
  return note
    .replace(/[‒-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '')
    .trim();
}

/**
 * The clause that keeps a truncated PDF from passing itself off as complete.
 * It rides in the header scope line, next to the date range, because that is
 * the line a reader already checks to learn what the document covers — and
 * unlike the `Page N of M` footer, it describes what was *matched* rather than
 * what was printed.
 *
 * Deliberately WinAnsi-encodable. The standard PDF fonts cover Latin-1, and
 * `toWinAnsi` folds anything else — a `⚠` reaches the page as a bare `?`,
 * which reads as an encoding glitch rather than a warning (see
 * spec/behavior/reports.md § Text degradation). The em dash survives here; the
 * emphasis has to come from the word.
 */
function truncationNotice(result: ReportResult<unknown>): string | undefined {
  if (!result.truncated) return undefined;
  return `INCOMPLETE — ${
    result.note ??
    `capped at the first ${result.limit.toLocaleString('en-US')} rows`
  }`;
}

@ApiTags('Reports')
@ApiBearerAuth()
@ApiExtraModels(ReportExportResponseDto)
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.REPORTS_EXPORT)
@RequireModule('reports')
@Controller('reports')
export class ReportController {
  private readonly logger = new Logger(ReportController.name);

  constructor(
    private readonly reportService: ReportService,
    private readonly reportExportService: ReportExportService,
  ) {}

  @Post('attendance')
  @ThrottleExpensiveWrite()
  @ApiOperation({ summary: 'Generate attendance report data' })
  @ApiQuery(FORMAT_QUERY)
  @ApiCreatedResponse(EXPORT_RESPONSE)
  async attendance(
    @CurrentChapterId() chapterId: string,
    @Body() dto: AttendanceReportDto,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    assertSupportedFormat(format);
    const result = await this.reportService.getAttendanceReport(chapterId, {
      event_id: dto.event_id,
      start_date: dto.start_date,
      end_date: dto.end_date,
    });
    return this.respond(chapterId, 'attendance', result, format, res, () =>
      scopeLine([
        dateRange(dto.start_date, dto.end_date),
        dto.event_id ? 'Single event' : 'All events',
      ]),
    );
  }

  @Post('points')
  @ThrottleExpensiveWrite()
  @ApiOperation({ summary: 'Generate points report data' })
  @ApiQuery(FORMAT_QUERY)
  @ApiCreatedResponse(EXPORT_RESPONSE)
  async points(
    @CurrentChapterId() chapterId: string,
    @Body() dto: PointsReportDto,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    assertSupportedFormat(format);
    const result = await this.reportService.getPointsReport(chapterId, {
      user_id: dto.user_id,
      window: dto.window,
      semester_archive_id: dto.semester_archive_id,
    });
    return this.respond(chapterId, 'points', result, format, res, () =>
      scopeLine([
        dto.semester_archive_id
          ? `Archive: ${dto.semester_archive_id}`
          : `Window: ${dto.window ?? 'all'}`,
        dto.user_id ? 'Single member' : 'All members',
      ]),
    );
  }

  @Post('roster')
  @ThrottleExpensiveWrite()
  @ApiOperation({ summary: 'Generate member roster data' })
  @ApiQuery(FORMAT_QUERY)
  @ApiCreatedResponse(EXPORT_RESPONSE)
  async roster(
    @CurrentChapterId() chapterId: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    assertSupportedFormat(format);
    const result = await this.reportService.getRosterReport(chapterId);
    return this.respond(chapterId, 'roster', result, format, res, () =>
      scopeLine(['Current members']),
    );
  }

  @Post('service')
  @ThrottleExpensiveWrite()
  @ApiOperation({ summary: 'Generate service hours report data' })
  @ApiQuery(FORMAT_QUERY)
  @ApiCreatedResponse(EXPORT_RESPONSE)
  async service(
    @CurrentChapterId() chapterId: string,
    @Body() dto: ServiceReportDto,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    assertSupportedFormat(format);
    const result = await this.reportService.getServiceReport(chapterId, {
      user_id: dto.user_id,
      start_date: dto.start_date,
      end_date: dto.end_date,
    });
    return this.respond(chapterId, 'service', result, format, res, () =>
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
    result: ReportResult<T>,
    format: string | undefined,
    res: Response | undefined,
    subtitle: () => string | undefined,
  ) {
    const columns = REPORT_COLUMNS[kind];
    const { rows, truncated } = result;

    if (truncated) {
      // A short report that does not announce itself reads as a complete
      // record of the chapter, and these get emailed to nationals and
      // advisors. Log it too: the caller may be a script that drops headers.
      this.logger.warn(
        `${kind} report for chapter ${chapterId} is incomplete — ${
          result.note ?? `hit the ${result.limit}-row ceiling`
        }.`,
      );
      res?.setHeader(TRUNCATED_HEADER, 'true');
      res?.setHeader(ROW_LIMIT_HEADER, String(result.limit));
      const headerNote = result.note && toHeaderValue(result.note);
      if (headerNote) {
        res?.setHeader(TRUNCATION_NOTE_HEADER, headerNote);
      }
    }

    if (format === 'pdf') {
      return this.reportExportService.exportPdf(
        chapterId,
        kind,
        columns,
        rows,
        scopeLine([subtitle(), truncationNotice(result)]),
        truncated,
        result.limit,
        result.note,
      );
    }

    if (format === 'csv') {
      res?.setHeader('Content-Type', 'text/csv');
      res?.setHeader(
        'Content-Disposition',
        `attachment; filename="${kind}-report.csv"`,
      );
      return toCSV(rows, columns);
    }

    return rows;
  }
}

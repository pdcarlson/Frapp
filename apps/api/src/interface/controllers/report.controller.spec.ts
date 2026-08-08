import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReportController } from './report.controller';
import {
  REPORT_MAX_ROWS,
  ReportService,
  type ReportResult,
} from '../../application/services/report.service';
import { ReportExportService } from '../../application/services/report-export.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import {
  AttendanceReportDto,
  PointsReportDto,
  ServiceReportDto,
} from '../dtos/report.dto';
import { toCSV } from '../../domain/utils/csv';
import {
  ATTENDANCE_COLUMNS,
  POINTS_COLUMNS,
  ROSTER_COLUMNS,
  SERVICE_COLUMNS,
} from './report-columns';

// Mock the toCSV utility function
jest.mock('../../domain/utils/csv', () => ({
  toCSV: jest.fn().mockReturnValue('mocked,csv,content'),
}));

/** A service result that ran to completion — the ordinary case. */
const complete = <T>(rows: T[]): ReportResult<T> => ({
  rows,
  truncated: false,
  limit: REPORT_MAX_ROWS,
});

/** A service result the row ceiling cut short. */
const short = <T>(rows: T[], note?: string): ReportResult<T> => ({
  rows,
  truncated: true,
  limit: REPORT_MAX_ROWS,
  note,
});

describe('ReportController', () => {
  let controller: ReportController;
  let reportService: jest.Mocked<ReportService>;
  let reportExportService: jest.Mocked<ReportExportService>;

  const exportResult = {
    url: 'https://storage.example/signed',
    expires_at: '2026-08-05T15:00:00.000Z',
    expires_in: 3600,
    filename: 'frapp-attendance-report-2026-08-05.pdf',
    storage_path: 'chapters/chapter-123/reports/attendance-2026-08-05-uuid.pdf',
    row_count: 1,
    truncated: false,
    row_limit: REPORT_MAX_ROWS,
    truncation_note: undefined,
  };

  beforeEach(async () => {
    reportService = {
      getAttendanceReport: jest.fn(),
      getPointsReport: jest.fn(),
      getRosterReport: jest.fn(),
      getServiceReport: jest.fn(),
    } as any;

    reportExportService = {
      exportPdf: jest.fn().mockResolvedValue(exportResult),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportController],
      providers: [
        { provide: ReportService, useValue: reportService },
        { provide: ReportExportService, useValue: reportExportService },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReportController>(ReportController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('attendance', () => {
    const chapterId = 'chapter-123';
    const dto: AttendanceReportDto = {
      event_id: 'event-123',
      start_date: '2024-01-01',
      end_date: '2024-01-31',
    };
    const mockData = [
      {
        member_name: 'John Doe',
        event_name: 'Meeting',
        event_date: '2024-01-15',
        status: 'PRESENT',
        check_in_time: '2024-01-15T10:00:00Z',
      },
    ];

    it('should return attendance report data as JSON', async () => {
      reportService.getAttendanceReport.mockResolvedValue(complete(mockData));

      const result = await controller.attendance(chapterId, dto);

      expect(reportService.getAttendanceReport).toHaveBeenCalledWith(
        chapterId,
        {
          event_id: dto.event_id,
          start_date: dto.start_date,
          end_date: dto.end_date,
        },
      );
      expect(result).toBe(mockData);
    });

    it('should return attendance report data as CSV', async () => {
      reportService.getAttendanceReport.mockResolvedValue(complete(mockData));
      const res: any = { setHeader: jest.fn() };

      const result = await controller.attendance(chapterId, dto, 'csv', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="attendance-report.csv"',
      );
      expect(toCSV).toHaveBeenCalledWith(mockData, ATTENDANCE_COLUMNS);
      expect(result).toBe('mocked,csv,content');
    });
  });

  describe('points', () => {
    const chapterId = 'chapter-123';
    const dto: PointsReportDto = {
      user_id: 'user-123',
      window: 'Fall 2024',
    };
    const mockData = [
      {
        member_name: 'John Doe',
        total_points: 100,
        breakdown_by_category: { Meeting: 50 },
      },
    ];

    it('should return points report data as JSON', async () => {
      reportService.getPointsReport.mockResolvedValue(complete(mockData));

      const result = await controller.points(chapterId, dto);

      expect(reportService.getPointsReport).toHaveBeenCalledWith(chapterId, {
        user_id: dto.user_id,
        window: dto.window,
      });
      expect(result).toBe(mockData);
    });

    it('should return points report data as CSV', async () => {
      reportService.getPointsReport.mockResolvedValue(complete(mockData));
      const res: any = { setHeader: jest.fn() };

      const result = await controller.points(chapterId, dto, 'csv', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="points-report.csv"',
      );
      expect(toCSV).toHaveBeenCalledWith(mockData, POINTS_COLUMNS);
      expect(result).toBe('mocked,csv,content');
    });
  });

  describe('roster', () => {
    const chapterId = 'chapter-123';
    const mockData = [
      {
        name: 'John Doe',
        email: 'john@example.com',
        roles: ['Member'],
        join_date: '2024-01-01',
        point_balance: 50,
      },
    ];

    it('should return roster report data as JSON', async () => {
      reportService.getRosterReport.mockResolvedValue(complete(mockData));

      const result = await controller.roster(chapterId);

      expect(reportService.getRosterReport).toHaveBeenCalledWith(chapterId);
      expect(result).toBe(mockData);
    });

    it('should return roster report data as CSV', async () => {
      reportService.getRosterReport.mockResolvedValue(complete(mockData));
      const res: any = { setHeader: jest.fn() };

      const result = await controller.roster(chapterId, 'csv', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="roster-report.csv"',
      );
      expect(toCSV).toHaveBeenCalledWith(mockData, ROSTER_COLUMNS);
      expect(result).toBe('mocked,csv,content');
    });
  });

  describe('service', () => {
    const chapterId = 'chapter-123';
    const dto: ServiceReportDto = {
      user_id: 'user-123',
      start_date: '2024-01-01',
      end_date: '2024-01-31',
    };
    const mockData = [
      {
        member_name: 'John Doe',
        date: '2024-01-15',
        duration_minutes: 120,
        description: 'Volunteering',
        status: 'APPROVED',
      },
    ];

    it('should return service report data as JSON', async () => {
      reportService.getServiceReport.mockResolvedValue(complete(mockData));

      const result = await controller.service(chapterId, dto);

      expect(reportService.getServiceReport).toHaveBeenCalledWith(chapterId, {
        user_id: dto.user_id,
        start_date: dto.start_date,
        end_date: dto.end_date,
      });
      expect(result).toBe(mockData);
    });

    it('should return service report data as CSV', async () => {
      reportService.getServiceReport.mockResolvedValue(complete(mockData));
      const res: any = { setHeader: jest.fn() };

      const result = await controller.service(chapterId, dto, 'csv', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="service-report.csv"',
      );
      expect(toCSV).toHaveBeenCalledWith(mockData, SERVICE_COLUMNS);
      expect(result).toBe('mocked,csv,content');
    });
  });

  describe('truncation signalling', () => {
    const chapterId = 'chapter-123';

    it('flags a truncated JSON report in headers, leaving the array body alone', async () => {
      // The body stays a bare array on purpose: wrapping it to carry one
      // boolean would break every existing caller of a shipped endpoint.
      const rows = [{ name: 'John Doe' }] as any;
      reportService.getRosterReport.mockResolvedValue(short(rows));
      const res: any = { setHeader: jest.fn() };

      const result = await controller.roster(chapterId, undefined, res);

      expect(result).toBe(rows);
      expect(res.setHeader).toHaveBeenCalledWith('X-Report-Truncated', 'true');
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Report-Row-Limit',
        String(REPORT_MAX_ROWS),
      );
    });

    it('flags a truncated CSV report in headers', async () => {
      reportService.getServiceReport.mockResolvedValue(short([]));
      const res: any = { setHeader: jest.fn() };

      await controller.service(chapterId, {}, 'csv', res);

      expect(res.setHeader).toHaveBeenCalledWith('X-Report-Truncated', 'true');
    });

    it('carries the note in a header so json/csv callers learn what was cut', async () => {
      // Without this the only channel explaining "it is the balances, not the
      // rows" is the PDF body, and a json/csv caller sees a row limit the
      // report never reached.
      reportService.getServiceReport.mockResolvedValue(
        short([], 'point balances are incomplete'),
      );
      const res: any = { setHeader: jest.fn() };

      await controller.service(chapterId, {}, 'csv', res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Report-Truncation-Note',
        'point balances are incomplete',
      );
    });

    it('sets no truncation header on a complete report', async () => {
      reportService.getRosterReport.mockResolvedValue(complete([]));
      const res: any = { setHeader: jest.fn() };

      await controller.roster(chapterId, undefined, res);

      const headers = res.setHeader.mock.calls.map((c: string[]) => c[0]);
      expect(headers).not.toContain('X-Report-Truncated');
      expect(headers).not.toContain('X-Report-Row-Limit');
    });
  });

  describe('format=pdf', () => {
    const chapterId = 'chapter-123';

    it('returns the signed-URL envelope rather than a document body', async () => {
      reportService.getRosterReport.mockResolvedValue(complete([]));

      const result = await controller.roster(chapterId, 'pdf');

      expect(result).toBe(exportResult);
      expect(toCSV).not.toHaveBeenCalled();
    });

    it('renders attendance with the shared columns and a filter scope line', async () => {
      reportService.getAttendanceReport.mockResolvedValue(complete([]));

      await controller.attendance(
        chapterId,
        { start_date: '2026-01-01', end_date: '2026-05-31' },
        'pdf',
      );

      expect(reportExportService.exportPdf).toHaveBeenCalledWith(
        chapterId,
        'attendance',
        ATTENDANCE_COLUMNS,
        [],
        '2026-01-01 – 2026-05-31 · All events',
        false,
        REPORT_MAX_ROWS,
        undefined,
      );
    });

    it('names a single-event attendance export in its scope line', async () => {
      reportService.getAttendanceReport.mockResolvedValue(complete([]));

      await controller.attendance(chapterId, { event_id: 'event-1' }, 'pdf');

      expect(reportExportService.exportPdf).toHaveBeenCalledWith(
        chapterId,
        'attendance',
        ATTENDANCE_COLUMNS,
        [],
        'All dates · Single event',
        false,
        REPORT_MAX_ROWS,
        undefined,
      );
    });

    it('carries the points window into the scope line', async () => {
      reportService.getPointsReport.mockResolvedValue(complete([]));

      await controller.points(chapterId, { window: 'semester' }, 'pdf');

      expect(reportExportService.exportPdf).toHaveBeenCalledWith(
        chapterId,
        'points',
        POINTS_COLUMNS,
        [],
        'Window: semester · All members',
        false,
        REPORT_MAX_ROWS,
        undefined,
      );
    });

    it('scopes a service export to one member when filtered', async () => {
      reportService.getServiceReport.mockResolvedValue(complete([]));

      await controller.service(
        chapterId,
        { user_id: 'user-1', start_date: '2026-03-01' },
        'pdf',
      );

      expect(reportExportService.exportPdf).toHaveBeenCalledWith(
        chapterId,
        'service',
        SERVICE_COLUMNS,
        [],
        'From 2026-03-01 · Single member',
        false,
        REPORT_MAX_ROWS,
        undefined,
      );
    });

    it('defaults to the JSON path when no format is given', async () => {
      const rows = [{ name: 'John Doe' }] as any;
      reportService.getRosterReport.mockResolvedValue(complete(rows));

      const result = await controller.roster(chapterId);

      expect(result).toBe(rows);
      expect(reportExportService.exportPdf).not.toHaveBeenCalled();
      expect(toCSV).not.toHaveBeenCalled();
    });

    it('prints the aggregate ceiling and its note when balances are what truncated', async () => {
      // Regression: the notice used to hardcode REPORT_MAX_ROWS, so a
      // complete roster with incomplete balances printed a row cap it never
      // hit — a number contradicting the document in front of the reader.
      reportService.getRosterReport.mockResolvedValue({
        rows: [],
        truncated: true,
        limit: 50_000,
        note: 'point balances are incomplete — summed from the first 50,000 transactions',
      });
      const res: any = { setHeader: jest.fn() };

      await controller.roster(chapterId, 'pdf', res);

      expect(reportExportService.exportPdf).toHaveBeenCalledWith(
        chapterId,
        'roster',
        ROSTER_COLUMNS,
        [],
        'Current members · INCOMPLETE — point balances are incomplete — summed from the first 50,000 transactions',
        true,
        50_000,
        'point balances are incomplete — summed from the first 50,000 transactions',
      );
      expect(res.setHeader).toHaveBeenCalledWith('X-Report-Row-Limit', '50000');
    });

    it('prints the incomplete notice in the PDF scope line', async () => {
      // A truncated PDF that looks complete is the whole point of #686: these
      // get emailed to nationals, and `Page N of M` describes what was
      // printed, not what matched.
      reportService.getAttendanceReport.mockResolvedValue(short([]));

      await controller.attendance(
        chapterId,
        { start_date: '2026-01-01', end_date: '2026-05-31' },
        'pdf',
      );

      expect(reportExportService.exportPdf).toHaveBeenCalledWith(
        chapterId,
        'attendance',
        ATTENDANCE_COLUMNS,
        [],
        `2026-01-01 – 2026-05-31 · All events · INCOMPLETE — capped at the first ${REPORT_MAX_ROWS.toLocaleString('en-US')} rows`,
        true,
        REPORT_MAX_ROWS,
        undefined,
      );
    });

    it.each(['xlsx', 'PDF', 'Csv', ''])(
      'rejects the unsupported format %p rather than serving JSON',
      async (format) => {
        // Silently returning rows for `format=PDF` gives an external caller no
        // signal that it did not get the download envelope it asked for.
        reportService.getRosterReport.mockResolvedValue(complete([]));

        await expect(controller.roster(chapterId, format)).rejects.toThrow(
          BadRequestException,
        );
        expect(reportExportService.exportPdf).not.toHaveBeenCalled();
        expect(toCSV).not.toHaveBeenCalled();
      },
    );
  });
});

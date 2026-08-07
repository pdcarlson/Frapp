import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReportController } from './report.controller';
import { ReportService } from '../../application/services/report.service';
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
      reportService.getAttendanceReport.mockResolvedValue(mockData);

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
      reportService.getAttendanceReport.mockResolvedValue(mockData);
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
      reportService.getPointsReport.mockResolvedValue(mockData);

      const result = await controller.points(chapterId, dto);

      expect(reportService.getPointsReport).toHaveBeenCalledWith(chapterId, {
        user_id: dto.user_id,
        window: dto.window,
      });
      expect(result).toBe(mockData);
    });

    it('should return points report data as CSV', async () => {
      reportService.getPointsReport.mockResolvedValue(mockData);
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
      reportService.getRosterReport.mockResolvedValue(mockData);

      const result = await controller.roster(chapterId);

      expect(reportService.getRosterReport).toHaveBeenCalledWith(chapterId);
      expect(result).toBe(mockData);
    });

    it('should return roster report data as CSV', async () => {
      reportService.getRosterReport.mockResolvedValue(mockData);
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
      reportService.getServiceReport.mockResolvedValue(mockData);

      const result = await controller.service(chapterId, dto);

      expect(reportService.getServiceReport).toHaveBeenCalledWith(chapterId, {
        user_id: dto.user_id,
        start_date: dto.start_date,
        end_date: dto.end_date,
      });
      expect(result).toBe(mockData);
    });

    it('should return service report data as CSV', async () => {
      reportService.getServiceReport.mockResolvedValue(mockData);
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

  describe('format=pdf', () => {
    const chapterId = 'chapter-123';

    it('returns the signed-URL envelope rather than a document body', async () => {
      reportService.getRosterReport.mockResolvedValue([]);

      const result = await controller.roster(chapterId, 'pdf');

      expect(result).toBe(exportResult);
      expect(toCSV).not.toHaveBeenCalled();
    });

    it('renders attendance with the shared columns and a filter scope line', async () => {
      reportService.getAttendanceReport.mockResolvedValue([]);

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
      );
    });

    it('names a single-event attendance export in its scope line', async () => {
      reportService.getAttendanceReport.mockResolvedValue([]);

      await controller.attendance(chapterId, { event_id: 'event-1' }, 'pdf');

      expect(reportExportService.exportPdf).toHaveBeenCalledWith(
        chapterId,
        'attendance',
        ATTENDANCE_COLUMNS,
        [],
        'All dates · Single event',
      );
    });

    it('carries the points window into the scope line', async () => {
      reportService.getPointsReport.mockResolvedValue([]);

      await controller.points(chapterId, { window: 'semester' }, 'pdf');

      expect(reportExportService.exportPdf).toHaveBeenCalledWith(
        chapterId,
        'points',
        POINTS_COLUMNS,
        [],
        'Window: semester · All members',
      );
    });

    it('scopes a service export to one member when filtered', async () => {
      reportService.getServiceReport.mockResolvedValue([]);

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
      );
    });

    it('defaults to the JSON path when no format is given', async () => {
      const rows = [{ name: 'John Doe' }] as any;
      reportService.getRosterReport.mockResolvedValue(rows);

      const result = await controller.roster(chapterId);

      expect(result).toBe(rows);
      expect(reportExportService.exportPdf).not.toHaveBeenCalled();
      expect(toCSV).not.toHaveBeenCalled();
    });

    it.each(['xlsx', 'PDF', 'Csv', ''])(
      'rejects the unsupported format %p rather than serving JSON',
      async (format) => {
        // Silently returning rows for `format=PDF` gives an external caller no
        // signal that it did not get the download envelope it asked for.
        reportService.getRosterReport.mockResolvedValue([]);

        await expect(controller.roster(chapterId, format)).rejects.toThrow(
          BadRequestException,
        );
        expect(reportExportService.exportPdf).not.toHaveBeenCalled();
        expect(toCSV).not.toHaveBeenCalled();
      },
    );
  });
});

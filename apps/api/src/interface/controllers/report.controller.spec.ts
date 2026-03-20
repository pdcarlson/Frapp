import { Test, TestingModule } from '@nestjs/testing';
import { ReportController } from './report.controller';
import { ReportService } from '../../application/services/report.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { AttendanceReportDto, PointsReportDto, ServiceReportDto } from '../dtos/report.dto';
import { toCSV } from '../../domain/utils/csv';
import { ATTENDANCE_COLUMNS, POINTS_COLUMNS, ROSTER_COLUMNS, SERVICE_COLUMNS } from './report-columns';

// Mock the toCSV utility function
jest.mock('../../domain/utils/csv', () => ({
  toCSV: jest.fn().mockReturnValue('mocked,csv,content'),
}));

describe('ReportController', () => {
  let controller: ReportController;
  let reportService: jest.Mocked<ReportService>;

  beforeEach(async () => {
    reportService = {
      getAttendanceReport: jest.fn(),
      getPointsReport: jest.fn(),
      getRosterReport: jest.fn(),
      getServiceReport: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportController],
      providers: [{ provide: ReportService, useValue: reportService }],
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
    const mockData = [{ member_name: 'John Doe', event_name: 'Meeting', event_date: '2024-01-15', status: 'PRESENT', check_in_time: '2024-01-15T10:00:00Z' }];

    it('should return attendance report data as JSON', async () => {
      reportService.getAttendanceReport.mockResolvedValue(mockData);

      const result = await controller.attendance(chapterId, dto);

      expect(reportService.getAttendanceReport).toHaveBeenCalledWith(chapterId, {
        event_id: dto.event_id,
        start_date: dto.start_date,
        end_date: dto.end_date,
      });
      expect(result).toBe(mockData);
    });

    it('should return attendance report data as CSV', async () => {
      reportService.getAttendanceReport.mockResolvedValue(mockData);
      const res: any = { setHeader: jest.fn() };

      const result = await controller.attendance(chapterId, dto, 'csv', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="attendance-report.csv"');
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
    const mockData = [{ member_name: 'John Doe', total_points: 100, breakdown_by_category: { 'Meeting': 50 } }];

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
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="points-report.csv"');
      expect(toCSV).toHaveBeenCalledWith(mockData, POINTS_COLUMNS);
      expect(result).toBe('mocked,csv,content');
    });
  });

  describe('roster', () => {
    const chapterId = 'chapter-123';
    const mockData = [{ name: 'John Doe', email: 'john@example.com', roles: ['Member'], join_date: '2024-01-01', point_balance: 50 }];

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
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="roster-report.csv"');
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
    const mockData = [{ member_name: 'John Doe', date: '2024-01-15', duration_minutes: 120, description: 'Volunteering', status: 'APPROVED' }];

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
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="service-report.csv"');
      expect(toCSV).toHaveBeenCalledWith(mockData, SERVICE_COLUMNS);
      expect(result).toBe('mocked,csv,content');
    });
  });
});

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AttendanceService } from '../src/application/services/attendance.service';
import { PointsService } from '../src/application/services/points.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import { createSupabaseMock } from './helpers/supabase-mock.factory';

const V1 = '/v1';

class AuthGuardStub implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.supabaseUser = { id: 'auth-user-1', email: 'member@example.com' };
    return true;
  }
}

class ChapterGuardStub implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.appUser = { id: 'user-1' };
    request.member = { id: 'member-1', role_ids: ['role-member'] };
    request.chapterId = 'chapter-1';
    return true;
  }
}

class PermissionsGuardStub implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('Attendance + points flow (e2e)', () => {
  let app: INestApplication;
  const attendanceServiceMock = {
    checkIn: jest.fn().mockResolvedValue({
      id: 'att-1',
      event_id: 'evt-1',
      user_id: 'user-1',
      status: 'PRESENT',
      check_in_time: new Date().toISOString(),
    }),
    getAttendance: jest.fn(),
    updateStatus: jest.fn(),
    markAutoAbsent: jest.fn(),
  };
  const pointsServiceMock = {
    getUserSummary: jest.fn().mockResolvedValue({
      total: 120,
      transactions: [],
    }),
    getLeaderboard: jest.fn().mockResolvedValue([]),
    adjustPoints: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(createSupabaseMock())
      .overrideProvider(AttendanceService)
      .useValue(attendanceServiceMock)
      .overrideProvider(PointsService)
      .useValue(pointsServiceMock)
      .overrideGuard(SupabaseAuthGuard)
      .useClass(AuthGuardStub)
      .overrideGuard(ChapterGuard)
      .useClass(ChapterGuardStub)
      .overrideGuard(PermissionsGuard)
      .useClass(PermissionsGuardStub)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('checks in and forwards chapter/user/event context to attendance service', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/events/evt-1/attendance/check-in`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({})
      .expect(201);

    expect(attendanceServiceMock.checkIn).toHaveBeenCalledWith(
      'evt-1',
      'user-1',
      'chapter-1',
    );
  });

  it('returns current user points summary with chapter scope', async () => {
    await request(app.getHttpServer())
      .get(`${V1}/points/me`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .expect(200);

    expect(pointsServiceMock.getUserSummary).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      'all',
    );
  });
});

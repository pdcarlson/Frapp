import { Test, TestingModule } from '@nestjs/testing';
import { ChapterAuditLogController } from './chapter-audit-log.controller';
import { ChapterAuditLogService } from '../../application/services/chapter-audit-log.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';

const MEMBER = {
  id: 'member-1',
  user_id: 'user-1',
  chapter_id: 'chapter-1',
  role_ids: ['role-president-1'],
  custom_role_ids: ['custom-role-9'],
  has_completed_onboarding: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
} as never;

describe('ChapterAuditLogController', () => {
  let controller: ChapterAuditLogController;
  let service: jest.Mocked<ChapterAuditLogService>;

  beforeEach(async () => {
    service = {
      list: jest.fn(),
    } as never;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChapterAuditLogController],
      providers: [{ provide: ChapterAuditLogService, useValue: service }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ChapterAuditLogController>(
      ChapterAuditLogController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('delegates to the service with the caller chapter and query params', async () => {
      const expected = [{ id: 'entry-1' }] as never;
      service.list.mockResolvedValue(expected);

      const result = await controller.list('chapter-1', MEMBER, {
        before: '2026-01-01T00:00:00.000Z',
        limit: 25,
      });

      expect(service.list).toHaveBeenCalledWith(
        'chapter-1',
        { roleIds: ['role-president-1'] },
        {
          before: '2026-01-01T00:00:00.000Z',
          actorUserId: undefined,
          action: undefined,
          startDate: undefined,
          endDate: undefined,
          limit: 25,
        },
      );
      expect(result).toBe(expected);
    });

    // The wire names are snake_case and the service's are camelCase, so this
    // mapping is hand-written and a rename on either side is silent without
    // an assertion naming both.
    it('maps every snake_case query param onto its service option', async () => {
      service.list.mockResolvedValue([] as never);

      await controller.list('chapter-1', MEMBER, {
        actor_user_id: '00000000-0000-4000-8000-0000000000a1',
        action: 'member_removed',
        start_date: '2026-01-01T00:00:00.000Z',
        end_date: '2026-02-01T00:00:00.000Z',
        before: '2026-03-01T00:00:00.000Z',
        limit: 10,
      });

      expect(service.list).toHaveBeenCalledWith(
        'chapter-1',
        { roleIds: ['role-president-1'] },
        {
          actorUserId: '00000000-0000-4000-8000-0000000000a1',
          action: 'member_removed',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-02-01T00:00:00.000Z',
          before: '2026-03-01T00:00:00.000Z',
          limit: 10,
        },
      );
    });

    it('passes undefined query params through untouched', async () => {
      service.list.mockResolvedValue([] as never);

      await controller.list('chapter-1', MEMBER, {});

      expect(service.list).toHaveBeenCalledWith(
        'chapter-1',
        { roleIds: ['role-president-1'] },
        {
          before: undefined,
          actorUserId: undefined,
          action: undefined,
          startDate: undefined,
          endDate: undefined,
          limit: undefined,
        },
      );
    });
  });
});

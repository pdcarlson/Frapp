import { Test, TestingModule } from '@nestjs/testing';
import { ChapterAuditLogController } from './chapter-audit-log.controller';
import { ChapterAuditLogService } from '../../application/services/chapter-audit-log.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';

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

      const result = await controller.list('chapter-1', {
        before: '2026-01-01T00:00:00.000Z',
        limit: 25,
      });

      expect(service.list).toHaveBeenCalledWith('chapter-1', {
        before: '2026-01-01T00:00:00.000Z',
        limit: 25,
      });
      expect(result).toBe(expected);
    });

    it('passes undefined query params through untouched', async () => {
      service.list.mockResolvedValue([] as never);

      await controller.list('chapter-1', {});

      expect(service.list).toHaveBeenCalledWith('chapter-1', {
        before: undefined,
        limit: undefined,
      });
    });
  });
});

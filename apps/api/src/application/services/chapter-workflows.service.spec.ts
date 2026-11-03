import { Test, TestingModule } from '@nestjs/testing';
import {
  ChapterWorkflowsService,
  ORG_WORKFLOWS_SEED,
} from './chapter-workflows.service';
import { CHAPTER_CONFIG_REPOSITORY } from '#domain/repositories/chapter-config.repository.interface';
import { SupabaseQueryError } from '../../infrastructure/supabase/supabase-query-error';

const CHAPTER_ID = 'ch-1';

// Deterministic stand-in for WORKFLOWS_SEED, injected via ORG_WORKFLOWS_SEED.
// We exercise the seed ⊕ override merge and the dues-grace rules only; the
// real catalog lives in @repo/org-archetypes.
const TEST_SEED = [
  {
    key: 'wf_dues_grace',
    label: 'Dues grace',
    enabled: true,
    threshold: 7,
    units: 'days',
  },
  { key: 'wf_hours_receipt', label: 'Hours receipt', enabled: true },
  { key: 'wf_event_photo', label: 'Event photo', enabled: false },
];

type WorkflowRow = { enabled: boolean; threshold: number | null } | null;

/**
 * Repository stub: `findWorkflow` resolves `workflowRow`, or rejects the way
 * the repository does on a query error when `error` is passed.
 */
function makeConfigRepo(
  workflowRow: WorkflowRow,
  error: { message: string } | null = null,
) {
  return {
    findWorkflow: error
      ? jest.fn().mockRejectedValue(new SupabaseQueryError(error))
      : jest.fn().mockResolvedValue(workflowRow),
  };
}

async function buildService(configRepo: { findWorkflow: jest.Mock }) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChapterWorkflowsService,
      { provide: CHAPTER_CONFIG_REPOSITORY, useValue: configRepo },
      { provide: ORG_WORKFLOWS_SEED, useValue: TEST_SEED },
    ],
  }).compile();
  return module.get(ChapterWorkflowsService);
}

describe('ChapterWorkflowsService', () => {
  describe('getWorkflow', () => {
    it('returns seed defaults when the chapter has no override row', async () => {
      const service = await buildService(makeConfigRepo(null));

      const result = await service.getWorkflow(CHAPTER_ID, 'wf_dues_grace');

      expect(result).toEqual({
        key: 'wf_dues_grace',
        enabled: true,
        threshold: 7,
      });
    });

    it('returns the chapter override when a row exists', async () => {
      const service = await buildService(
        makeConfigRepo({ enabled: false, threshold: 10 }),
      );

      const result = await service.getWorkflow(CHAPTER_ID, 'wf_dues_grace');

      expect(result).toEqual({
        key: 'wf_dues_grace',
        enabled: false,
        threshold: 10,
      });
    });

    it('falls back to the seed threshold when the row leaves it null', async () => {
      const service = await buildService(
        makeConfigRepo({ enabled: true, threshold: null }),
      );

      const result = await service.getWorkflow(CHAPTER_ID, 'wf_dues_grace');

      expect(result).toEqual({
        key: 'wf_dues_grace',
        enabled: true,
        threshold: 7,
      });
    });

    it('treats an unknown key with no row as disabled', async () => {
      const service = await buildService(makeConfigRepo(null));

      const result = await service.getWorkflow(CHAPTER_ID, 'wf_unknown');

      expect(result).toEqual({
        key: 'wf_unknown',
        enabled: false,
        threshold: null,
      });
    });

    it('falls back to seed defaults and logs when the read errors', async () => {
      const service = await buildService(
        makeConfigRepo(
          { enabled: false, threshold: null },
          {
            message: 'connection reset',
          },
        ),
      );
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: (msg: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      const result = await service.getWorkflow(CHAPTER_ID, 'wf_hours_receipt');

      // The chapter's explicit disable is unreadable during the outage; the
      // seed default applies and the substitution is logged.
      expect(result).toEqual({
        key: 'wf_hours_receipt',
        enabled: true,
        threshold: null,
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('chapter_workflows read failed'),
      );
    });

    it('reads the override for the requested chapter and key', async () => {
      const repo = makeConfigRepo(null);
      const service = await buildService(repo);

      await service.getWorkflow(CHAPTER_ID, 'wf_dues_grace');

      expect(repo.findWorkflow).toHaveBeenCalledWith(
        CHAPTER_ID,
        'wf_dues_grace',
      );
    });
  });

  describe('getDuesGraceDays', () => {
    it('returns 0 when wf_dues_grace is disabled for the chapter', async () => {
      const service = await buildService(
        makeConfigRepo({ enabled: false, threshold: 10 }),
      );

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(0);
    });

    it('returns the chapter workflow threshold when set', async () => {
      const service = await buildService(
        makeConfigRepo({ enabled: true, threshold: 10 }),
      );

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(10);
    });

    it('honors an explicit zero-day grace', async () => {
      const service = await buildService(
        makeConfigRepo({ enabled: true, threshold: 0 }),
      );

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(0);
    });

    it('falls back to the seed threshold when unconfigured', async () => {
      const service = await buildService(makeConfigRepo(null));

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(7);
    });

    it('clamps an absurd threshold instead of overflowing date arithmetic', async () => {
      const service = await buildService(
        makeConfigRepo({ enabled: true, threshold: 999_999_999_999 }),
      );

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(365);
    });
  });
});

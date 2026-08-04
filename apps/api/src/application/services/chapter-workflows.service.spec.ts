import { Test, TestingModule } from '@nestjs/testing';
import {
  ChapterWorkflowsService,
  ORG_WORKFLOWS_SEED,
} from './chapter-workflows.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

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
 * Supabase stub: `chapter_workflows` resolves `workflowRow` through
 * `maybeSingle()`. Pass an `error` to exercise the read-failure fallback.
 */
function makeSupabase(
  workflowRow: WorkflowRow,
  error: { message: string } | null = null,
) {
  const from = jest.fn(() => {
    const builder: Record<string, jest.Mock> = {};
    builder.select = jest.fn().mockReturnValue(builder);
    builder.eq = jest.fn().mockReturnValue(builder);
    builder.maybeSingle = jest.fn().mockResolvedValue({
      data: error ? null : workflowRow,
      error,
    });
    return builder;
  });
  return { from };
}

async function buildService(supabase: { from: jest.Mock }) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChapterWorkflowsService,
      { provide: SUPABASE_CLIENT, useValue: supabase },
      { provide: ORG_WORKFLOWS_SEED, useValue: TEST_SEED },
    ],
  }).compile();
  return module.get(ChapterWorkflowsService);
}

describe('ChapterWorkflowsService', () => {
  describe('getWorkflow', () => {
    it('returns seed defaults when the chapter has no override row', async () => {
      const service = await buildService(makeSupabase(null));

      const result = await service.getWorkflow(CHAPTER_ID, 'wf_dues_grace');

      expect(result).toEqual({
        key: 'wf_dues_grace',
        enabled: true,
        threshold: 7,
      });
    });

    it('returns the chapter override when a row exists', async () => {
      const service = await buildService(
        makeSupabase({ enabled: false, threshold: 10 }),
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
        makeSupabase({ enabled: true, threshold: null }),
      );

      const result = await service.getWorkflow(CHAPTER_ID, 'wf_dues_grace');

      expect(result).toEqual({
        key: 'wf_dues_grace',
        enabled: true,
        threshold: 7,
      });
    });

    it('treats an unknown key with no row as disabled', async () => {
      const service = await buildService(makeSupabase(null));

      const result = await service.getWorkflow(CHAPTER_ID, 'wf_unknown');

      expect(result).toEqual({
        key: 'wf_unknown',
        enabled: false,
        threshold: null,
      });
    });

    it('falls back to seed defaults and logs when the read errors', async () => {
      const service = await buildService(
        makeSupabase(
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
  });

  describe('getDuesGraceDays', () => {
    it('returns 0 when wf_dues_grace is disabled for the chapter', async () => {
      const service = await buildService(
        makeSupabase({ enabled: false, threshold: 10 }),
      );

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(0);
    });

    it('returns the chapter workflow threshold when set', async () => {
      const service = await buildService(
        makeSupabase({ enabled: true, threshold: 10 }),
      );

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(10);
    });

    it('honors an explicit zero-day grace', async () => {
      const service = await buildService(
        makeSupabase({ enabled: true, threshold: 0 }),
      );

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(0);
    });

    it('falls back to the seed threshold when unconfigured', async () => {
      const service = await buildService(makeSupabase(null));

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(7);
    });

    it('clamps an absurd threshold instead of overflowing date arithmetic', async () => {
      const service = await buildService(
        makeSupabase({ enabled: true, threshold: 999_999_999_999 }),
      );

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(365);
    });
  });
});

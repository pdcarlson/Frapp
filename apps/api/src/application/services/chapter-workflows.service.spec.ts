import { Test, TestingModule } from '@nestjs/testing';
import {
  ChapterWorkflowsService,
  ORG_WORKFLOWS_SEED,
} from './chapter-workflows.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

const CHAPTER_ID = 'ch-1';

// Deterministic stand-in for WORKFLOWS_SEED (injected via ORG_WORKFLOWS_SEED —
// the real catalog is covered by the org-archetypes package itself). We
// exercise the seed ⊕ override merge and the dues-grace precedence only.
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
 * Supabase stub: `chapter_workflows` resolves `workflowRow` and
 * `chapter_dues_config` resolves `duesRow` through `maybeSingle()`.
 */
function makeSupabase(
  workflowRow: WorkflowRow,
  duesRow: { grace_days: number | null } | null = null,
) {
  const from = jest.fn((table: string) => {
    const row = table === 'chapter_workflows' ? workflowRow : duesRow;
    const builder: Record<string, jest.Mock> = {};
    builder.select = jest.fn().mockReturnValue(builder);
    builder.eq = jest.fn().mockReturnValue(builder);
    builder.maybeSingle = jest.fn().mockResolvedValue({
      data: row,
      error: null,
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
        thresholdOverridden: false,
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
        thresholdOverridden: true,
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
        thresholdOverridden: false,
      });
    });

    it('treats an unknown key with no row as disabled', async () => {
      const service = await buildService(makeSupabase(null));

      const result = await service.getWorkflow(CHAPTER_ID, 'wf_unknown');

      expect(result).toEqual({
        key: 'wf_unknown',
        enabled: false,
        threshold: null,
        thresholdOverridden: false,
      });
    });
  });

  describe('getDuesGraceDays', () => {
    it('returns 0 when wf_dues_grace is disabled for the chapter', async () => {
      const service = await buildService(
        makeSupabase({ enabled: false, threshold: 10 }, { grace_days: 5 }),
      );

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(0);
    });

    it('prefers the chapter workflow threshold when explicitly set', async () => {
      const service = await buildService(
        makeSupabase({ enabled: true, threshold: 10 }, { grace_days: 5 }),
      );

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(10);
    });

    it('falls back to chapter_dues_config.grace_days without a threshold override', async () => {
      const service = await buildService(
        makeSupabase({ enabled: true, threshold: null }, { grace_days: 5 }),
      );

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(5);
    });

    it('falls back to the seed threshold when neither knob is configured', async () => {
      const service = await buildService(makeSupabase(null, null));

      await expect(service.getDuesGraceDays(CHAPTER_ID)).resolves.toBe(7);
    });
  });
});

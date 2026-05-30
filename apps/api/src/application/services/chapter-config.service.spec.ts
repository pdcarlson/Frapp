// The shared @repo packages ship ESM-only dist; the API jest setup doesn't
// transform them. Mock the two pure helpers — their seed/palette logic is
// covered by each package's own tests. Here we exercise the config
// orchestration (workflow merge + audit-logged PATCH) only.
jest.mock('@repo/org-archetypes', () => ({
  buildChapterConfigFromArchetype: jest.fn(() => ({
    archetype: 'ifc',
    modules: { chat: true },
    rolePack: 'ifc_standard',
    vocabulary: { recruitment: 'Rush', pledge: 'New member', class: 'Class' },
    customFields: [],
    workflows: [
      {
        key: 'wf_budget_approval',
        label: 'Budget approval',
        enabled: true,
        threshold: 500,
        units: 'USD',
      },
      { key: 'wf_task_confirm', label: 'Task confirm', enabled: true },
      { key: 'wf_advisor_digest', label: 'Advisor digest', enabled: false },
    ],
    dues: {},
  })),
  getArchetype: jest.fn((key: string) => ({ key, rolePack: 'ifc_standard' })),
}));
jest.mock('@repo/chapter-theme', () => ({
  derivePalette: jest.fn(() => ({ palette: { '--side-bg': '#1F1A15' } })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ChapterConfigService } from './chapter-config.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

const CHAPTER_ID = 'ch-1';

type WorkflowRow = { key: string; enabled: boolean; threshold: number | null };

/**
 * Builds a Supabase client stub. `chapters` resolves the given row through
 * `maybeSingle()` (and `{error:null}` when an update is awaited); the other
 * tables resolve their awaited value directly. Mutating calls are captured so
 * tests can assert on them.
 */
function makeSupabase(workflowRows: WorkflowRow[]) {
  const chapterRow = {
    id: CHAPTER_ID,
    org_archetype: 'ifc',
    enabled_modules: {},
    vocabulary: {},
    branding: {},
    theme_palette: {},
    beta_config: { enabled: true, style: 'sidebar_pill' },
  };

  const workflowUpsert = jest.fn().mockReturnValue({ error: null });
  const auditInsert = jest.fn().mockResolvedValue({ error: null });
  const chapterUpdate = jest.fn();

  const from = jest.fn((table: string) => {
    if (table === 'chapters') {
      const builder: Record<string, jest.Mock> = {};
      builder.select = jest.fn().mockReturnValue(builder);
      builder.update = jest.fn((payload: unknown) => {
        chapterUpdate(payload);
        return builder;
      });
      // `eq` is the terminal for updates (awaited) and a passthrough for selects.
      builder.eq = jest.fn().mockReturnValue(
        Object.assign(Promise.resolve({ error: null }), {
          maybeSingle: jest
            .fn()
            .mockResolvedValue({ data: chapterRow, error: null }),
        }),
      );
      return builder;
    }
    if (table === 'chapter_workflows') {
      const builder: Record<string, jest.Mock> = {};
      builder.select = jest.fn().mockReturnValue(builder);
      builder.eq = jest
        .fn()
        .mockResolvedValue({ data: workflowRows, error: null });
      builder.upsert = jest.fn((rows: unknown, opts: unknown) =>
        workflowUpsert(rows, opts),
      );
      return builder;
    }
    if (table === 'chapter_audit_log') {
      return { insert: auditInsert };
    }
    return {};
  });

  return { from, workflowUpsert, auditInsert, chapterUpdate };
}

async function buildService(supabase: { from: jest.Mock }) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChapterConfigService,
      { provide: SUPABASE_CLIENT, useValue: supabase },
    ],
  }).compile();
  return module.get(ChapterConfigService);
}

describe('ChapterConfigService — workflows', () => {
  describe('getConfig', () => {
    it('returns the seed catalog when the chapter has no overrides', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      const config = await service.getConfig(CHAPTER_ID);

      expect(config.workflows).toEqual([
        {
          key: 'wf_budget_approval',
          label: 'Budget approval',
          enabled: true,
          threshold: 500,
          units: 'USD',
        },
        {
          key: 'wf_task_confirm',
          label: 'Task confirm',
          enabled: true,
          threshold: undefined,
          units: undefined,
        },
        {
          key: 'wf_advisor_digest',
          label: 'Advisor digest',
          enabled: false,
          threshold: undefined,
          units: undefined,
        },
      ]);
    });

    it('overlays chapter overrides (enabled + threshold) onto the catalog', async () => {
      const supabase = makeSupabase([
        { key: 'wf_budget_approval', enabled: true, threshold: 1000 },
        { key: 'wf_advisor_digest', enabled: true, threshold: null },
      ]);
      const service = await buildService(supabase);

      const config = await service.getConfig(CHAPTER_ID);
      const byKey = Object.fromEntries(config.workflows.map((w) => [w.key, w]));

      // override threshold wins; label/units stay from the seed catalog
      expect(byKey['wf_budget_approval']).toMatchObject({
        threshold: 1000,
        units: 'USD',
      });
      // override enabled wins; null threshold falls back to the seed default
      expect(byKey['wf_advisor_digest']).toMatchObject({ enabled: true });
    });
  });

  describe('patchConfig', () => {
    it('upserts only changed workflows and audits them on a workflows-only PATCH', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      await service.patchConfig(CHAPTER_ID, 'user-1', {
        workflows: [
          { key: 'wf_advisor_digest', enabled: true }, // false -> true
          { key: 'wf_task_confirm', enabled: true }, // unchanged (seed true)
        ],
      });

      // Only the changed workflow is upserted.
      expect(supabase.workflowUpsert).toHaveBeenCalledTimes(1);
      const [rows, opts] = supabase.workflowUpsert.mock.calls[0];
      expect(rows).toEqual([
        {
          chapter_id: CHAPTER_ID,
          key: 'wf_advisor_digest',
          enabled: true,
          threshold: null,
        },
      ]);
      expect(opts).toEqual({ onConflict: 'chapter_id,key' });

      // No chapters-table column changed, so it is never updated...
      expect(supabase.chapterUpdate).not.toHaveBeenCalled();
      // ...but the audit row still fires, carrying the workflows diff.
      expect(supabase.auditInsert).toHaveBeenCalledTimes(1);
      const auditRow = supabase.auditInsert.mock.calls[0][0];
      expect(auditRow.action).toBe('chapter_config_updated');
      expect(auditRow.diff.workflows.to).toHaveProperty('wf_advisor_digest');
      expect(auditRow.diff.workflows.to).not.toHaveProperty('wf_task_confirm');
    });

    it('ignores unknown workflow keys (no bare write)', async () => {
      const supabase = makeSupabase([]);
      const service = await buildService(supabase);

      const result = await service.patchConfig(CHAPTER_ID, 'user-1', {
        workflows: [{ key: 'wf_not_in_catalog', enabled: true }],
      });

      // Nothing changed → no upsert, no audit, returns existing config.
      expect(supabase.workflowUpsert).not.toHaveBeenCalled();
      expect(supabase.auditInsert).not.toHaveBeenCalled();
      expect(result.id).toBe(CHAPTER_ID);
    });
  });
});

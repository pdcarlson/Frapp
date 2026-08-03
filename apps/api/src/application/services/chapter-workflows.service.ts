import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { WorkflowEntry } from '@repo/org-archetypes';

/**
 * DI token for the workflow catalog (`WORKFLOWS_SEED`), bound in
 * ChapterConfigModule. Injected as a value so this service file carries no
 * runtime import of the ESM-only `@repo/org-archetypes` dist — unit specs of
 * downstream services (service entries, invoices) would otherwise all have to
 * mock that package for jest.
 */
export const ORG_WORKFLOWS_SEED = 'ORG_WORKFLOWS_SEED';

/** Workflow keys wired into runtime enforcement (subset of WORKFLOWS_SEED). */
export const WORKFLOW_HOURS_RECEIPT = 'wf_hours_receipt';
export const WORKFLOW_DUES_GRACE = 'wf_dues_grace';

export interface EffectiveWorkflow {
  key: string;
  enabled: boolean;
  /** Chapter override when set, else the seed default (null when neither sets one). */
  threshold: number | null;
  /** True when the chapter row supplied the threshold (vs the seed default). */
  thresholdOverridden: boolean;
}

/**
 * Runtime lookup for chapter workflow toggles (Settings → Workflows).
 *
 * Mirrors the merge `ChapterConfigService.getConfig` performs for
 * presentation: `WORKFLOWS_SEED` is the catalog and default state, and a
 * `chapter_workflows` row overrides `enabled`/`threshold` per chapter. Domain
 * services consult this so an enabled toggle actually changes behavior
 * (spec/behavior/settings/customization.md → Workflows Tab).
 */
@Injectable()
export class ChapterWorkflowsService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @Inject(ORG_WORKFLOWS_SEED)
    private readonly workflowsSeed: readonly WorkflowEntry[],
  ) {}

  async getWorkflow(
    chapterId: string,
    key: string,
  ): Promise<EffectiveWorkflow> {
    const seed = this.workflowsSeed.find((wf) => wf.key === key);
    // A read error behaves like "no override" (seed defaults), the same
    // posture as the config endpoint — chapter policy still applies during a
    // transient DB hiccup.
    const { data } = await this.supabase
      .from('chapter_workflows')
      .select('enabled, threshold')
      .eq('chapter_id', chapterId)
      .eq('key', key)
      .maybeSingle();
    const row = data;
    if (!row) {
      return {
        key,
        enabled: seed?.enabled ?? false,
        threshold: seed?.threshold ?? null,
        thresholdOverridden: false,
      };
    }
    return {
      key,
      enabled: row.enabled,
      threshold: row.threshold ?? seed?.threshold ?? null,
      thresholdOverridden: row.threshold != null,
    };
  }

  /**
   * Effective dues grace period in days for overdue computations.
   *
   * `wf_dues_grace` disabled → 0 (an OPEN invoice is overdue the day after
   * `due_date`). Enabled → the workflow `threshold` when the chapter set one
   * (Settings → Workflows), else `chapter_dues_config.grace_days` (Settings →
   * Dues), else the seed default. Precedence is documented in
   * spec/behavior/settings/customization.md.
   */
  async getDuesGraceDays(chapterId: string): Promise<number> {
    const workflow = await this.getWorkflow(chapterId, WORKFLOW_DUES_GRACE);
    if (!workflow.enabled) return 0;
    if (workflow.thresholdOverridden && workflow.threshold != null) {
      return workflow.threshold;
    }
    const { data } = await this.supabase
      .from('chapter_dues_config')
      .select('grace_days')
      .eq('chapter_id', chapterId)
      .maybeSingle();
    const graceDays = data?.grace_days;
    return graceDays ?? workflow.threshold ?? 0;
  }
}

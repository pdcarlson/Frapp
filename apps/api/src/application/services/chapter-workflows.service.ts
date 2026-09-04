import { Inject, Injectable, Logger } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import type { WorkflowEntry } from '@repo/org-archetypes';

/**
 * DI token for the workflow catalog (`WORKFLOWS_SEED`), bound in
 * ChapterConfigModule. Injected as a value so this service file carries no
 * runtime import of `@repo/org-archetypes` — unit specs of downstream services
 * (service entries, invoices) would otherwise all have to mock that package
 * for jest.
 *
 * The original reason was narrower: that dist was ESM-only and jest could not
 * load it at all. #236 made the built output CJS, so the hard blocker is gone.
 * The indirection stays because the spec-ergonomics reason above still holds,
 * and unpicking it would change the wiring of every downstream consumer.
 */
export const ORG_WORKFLOWS_SEED = 'ORG_WORKFLOWS_SEED';

/** Workflow keys wired into runtime enforcement (subset of WORKFLOWS_SEED). */
export const WORKFLOW_HOURS_RECEIPT = 'wf_hours_receipt';
export const WORKFLOW_DUES_GRACE = 'wf_dues_grace';

/**
 * Upper bound on the dues grace period. The zod/DTO validation only requires
 * a nonnegative integer, and an absurd threshold would otherwise overflow the
 * date arithmetic in the overdue query (Invalid Date → 500s).
 */
const MAX_GRACE_DAYS = 365;

export interface EffectiveWorkflow {
  key: string;
  enabled: boolean;
  /** Chapter override when set, else the seed default (null when neither sets one). */
  threshold: number | null;
}

/**
 * Runtime lookup for chapter workflow toggles (Settings → Workflows).
 *
 * Mirrors the merge `ChapterConfigService.getConfig` performs for
 * presentation: `WORKFLOWS_SEED` is the catalog and default state, and a
 * `chapter_workflows` row overrides `enabled`/`threshold` per chapter. Domain
 * services consult this so an enabled toggle actually changes behavior
 * (spec/behavior/settings/customization.md → Workflows Tab).
 *
 * NOTE: the seed lookup is archetype-agnostic. That is correct for the keys
 * wired today, but `wf_budget_approval`'s threshold varies per archetype
 * (`buildChapterConfigFromArchetype` rewrites it) — wiring that key requires
 * an archetype-aware default, not this flat seed.
 */
@Injectable()
export class ChapterWorkflowsService {
  private readonly logger = new Logger(ChapterWorkflowsService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    @Inject(ORG_WORKFLOWS_SEED)
    private readonly workflowsSeed: readonly WorkflowEntry[],
  ) {}

  async getWorkflow(
    chapterId: string,
    key: string,
  ): Promise<EffectiveWorkflow> {
    const seed = this.workflowsSeed.find((wf) => wf.key === key);
    const { data, error } = await this.supabase
      .from('chapter_workflows')
      .select('enabled, threshold')
      .eq('chapter_id', chapterId)
      .eq('key', key)
      .maybeSingle();
    if (error) {
      // Fall back to the seed default — but say so: for a chapter whose
      // explicit setting differs from the seed, this substitutes the wrong
      // policy until reads recover.
      //
      // This deliberately DIVERGES from the config endpoint, which fails
      // *closed* on the same table (#1626): `ChapterConfigService.getConfig`
      // feeds `patchConfig`'s prior state and is upserted back as a whole row,
      // so defaulting there destroys the chapter's real config. Nothing is
      // written here — this is enforcement reading a policy — so failing open
      // degrades one decision rather than 500ing it. `ChapterPointsConfigService`
      // models the same split explicitly as `getConfig` / `getConfigOrThrow`.
      // Do not "restore consistency" by making either side match the other.
      this.logger.warn(
        `chapter_workflows read failed for chapter ${chapterId} key ${key}; applying seed default (enabled=${seed?.enabled ?? false}): ${error.message}`,
      );
    }
    const row = data;
    if (!row) {
      return {
        key,
        enabled: seed?.enabled ?? false,
        threshold: seed?.threshold ?? null,
      };
    }
    return {
      key,
      enabled: row.enabled,
      threshold: row.threshold ?? seed?.threshold ?? null,
    };
  }

  /**
   * Effective dues grace period in days for overdue computations.
   *
   * `wf_dues_grace` disabled → 0 (an OPEN invoice is overdue the day after
   * `due_date`). Enabled → the workflow's merged threshold (Settings →
   * Workflows; seed default 7), clamped to [0, MAX_GRACE_DAYS].
   *
   * `chapter_dues_config.grace_days` (Settings → Dues) is deliberately NOT
   * consulted. A fallback to it would only apply while the chapter has never
   * saved the Workflows tab: any save of `wf_dues_grace` materializes the
   * displayed threshold into the row (config PATCH behavior), permanently
   * shadowing `grace_days` — policy that depends on save history is not
   * policy. One authoritative knob instead; reconciling the duplicate
   * `grace_days` field is tracked separately (FRA-256 / FRA-227).
   */
  async getDuesGraceDays(chapterId: string): Promise<number> {
    const workflow = await this.getWorkflow(chapterId, WORKFLOW_DUES_GRACE);
    if (!workflow.enabled) return 0;
    const days = workflow.threshold ?? 0;
    return Math.min(Math.max(days, 0), MAX_GRACE_DAYS);
  }
}

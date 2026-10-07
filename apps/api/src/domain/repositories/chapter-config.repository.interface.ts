import type { ChapterWorkflow } from '../entities/chapter-workflow.entity';
import type { DuesConfig } from '../entities/chapter-dues-config.entity';
import type { ServiceConfig } from '../entities/chapter-service-config.entity';
import type { PointsConfig } from '../entities/chapter-points-config.entity';

export const CHAPTER_CONFIG_REPOSITORY = 'CHAPTER_CONFIG_REPOSITORY';

/** A chapter's override of one catalog workflow, as config reads it. */
export type ChapterWorkflowOverride = Pick<
  ChapterWorkflow,
  'key' | 'enabled' | 'threshold'
>;

/** One `chapter_workflows` row to upsert on `(chapter_id, key)`. */
export type ChapterWorkflowUpsert = Pick<
  ChapterWorkflow,
  'chapter_id' | 'key' | 'enabled' | 'threshold'
>;

/**
 * The per-chapter settings tables behind Settings → Workflows, Dues, Service
 * and Points: `chapter_workflows` and the three singleton rows keyed by
 * `chapter_id` (`chapter_dues_config`, `chapter_service_config`,
 * `chapter_points_config`).
 *
 * Every read throws on a query error rather than returning `null`, because
 * `null` already means "this chapter has no row yet". The callers decide what
 * an error means: `ChapterConfigService` fails closed (its read is the prior
 * state a PATCH merges onto), and the enforcement readers fail open to the
 * defaults. Collapsing the two here would take that choice away from them.
 */
export interface IChapterConfigRepository {
  /** Every workflow override the chapter has saved. */
  findWorkflows(chapterId: string): Promise<ChapterWorkflowOverride[]>;
  /** The chapter's override for one workflow key, or `null` when it has none. */
  findWorkflow(
    chapterId: string,
    key: string,
  ): Promise<Pick<ChapterWorkflow, 'enabled' | 'threshold'> | null>;
  upsertWorkflows(rows: ChapterWorkflowUpsert[]): Promise<void>;

  /** The stored dues plan, or `null` when the chapter has never saved one. */
  findDuesConfig(chapterId: string): Promise<DuesConfig | null>;
  upsertDuesConfig(chapterId: string, config: DuesConfig): Promise<void>;

  /** The stored service-hours policy, or `null` when there is none. */
  findServiceConfig(chapterId: string): Promise<ServiceConfig | null>;
  upsertServiceConfig(chapterId: string, config: ServiceConfig): Promise<void>;

  /**
   * The stored anti-fraud limits, or `null` when there are none. Returned as
   * stored: `ChapterPointsConfigService` validates each field before use.
   */
  findPointsConfig(chapterId: string): Promise<PointsConfig | null>;
  upsertPointsConfig(chapterId: string, config: PointsConfig): Promise<void>;
}

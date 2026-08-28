/**
 * A per-chapter workflow toggle (Settings → Workflows), persisted to
 * `chapter_workflows` (`20260523120000_chapter_customization.sql`).
 *
 * One row per `(chapter_id, key)`; `key` identifies a workflow in the
 * chapter's catalog. The write side is validated by
 * `ChapterWorkflowConfigSchema` in `packages/validation`.
 */
export interface ChapterWorkflow {
  id: string;
  chapter_id: string;
  key: string;
  enabled: boolean;
  /** Workflow-specific trigger threshold; null when the workflow takes none. */
  threshold: number | null;
  /** Additional workflow-specific configuration (jsonb, defaults to `{}`). */
  params: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

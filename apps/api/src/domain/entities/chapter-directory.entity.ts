/**
 * Curated national chapter directory backing onboarding autocomplete,
 * persisted to `chapter_directory` (`20260523140000_chapter_directory.sql`).
 *
 * Named `…Entry` rather than `ChapterDirectory` because a row is one
 * organization-at-one-school, not the directory itself.
 */
export interface ChapterDirectoryEntry {
  id: string;
  /** Greek letters, e.g. `ΦΓΔ`. */
  org_letters: string;
  org_name: string;
  /** One of `ArchetypeKey` (`packages/org-archetypes`); no DB CHECK enforces it. */
  archetype: string;
  /** The chapter's own designation, e.g. `Tau Nu`. */
  chapter_designation: string | null;
  university: string;
  university_short: string;
  founded_year: number | null;
  /**
   * `{ accent }` — one `#RRGGBB` hex (jsonb, defaults to `{}`).
   *
   * One key, not a pair: a chapter has exactly one accent input
   * (`spec/ui/design-system/accent-engine.md` §1). It held `{ dark, accent }`
   * until #1225, but nothing had read the `dark` half since #1224 removed
   * `branding.colors.dark`, and both onboarding wizards autofill from
   * `default_colors?.accent` alone. The column stays `Record<string, unknown>`
   * because it is unconstrained jsonb — deployed rows written before #1225 may
   * still carry an inert `dark`.
   */
  default_colors: Record<string, unknown>;
  website: string | null;
  /** Provenance tag for the row, e.g. `nic_2024`, `seed`, `manual`. */
  source: string;
  created_at: string;
  /**
   * `GENERATED ALWAYS … STORED` tsvector over the identity columns, backing
   * the onboarding autocomplete. No caller selects it (nobody wants the raw
   * lexemes) and it can never be written, but it is declared so this
   * interface describes the table as it actually is: `.eq`/`.order` are
   * checked against `keyof Row`, so an undeclared column is a compile error
   * at those call sites.
   *
   * Note this does *not* check `ChapterDirectoryService.search`, the one
   * place that names the column: `textSearch` carries a permissive
   * `(column: string, …)` overload alongside the `keyof Row` one, so that
   * call site resolves to the untyped overload either way.
   */
  search_vector: string;
}

export type ChapterDirectoryRequestStatus = 'pending' | 'imported' | 'rejected';

/**
 * A backfill candidate for the curated directory — raised when onboarding
 * finds no matching entry. Persisted to `chapter_directory_requests`
 * (`20260524120000_chapter_directory_requests.sql`).
 *
 * `chapter_id` and `requested_by` are `on delete set null` rather than
 * cascade: the candidate outlives the chapter or user that raised it, so the
 * backfill queue does not lose entries to unrelated deletions.
 */
export interface ChapterDirectoryRequest {
  id: string;
  chapter_id: string | null;
  /** Resolved server-side from the session, never from the client payload. */
  requested_by: string | null;
  org_letters: string | null;
  org_name: string | null;
  chapter_designation: string | null;
  /** The only field the requester must supply. */
  university: string;
  university_short: string | null;
  founded_year: number | null;
  archetype: string | null;
  notes: string | null;
  status: ChapterDirectoryRequestStatus;
  created_at: string;
}

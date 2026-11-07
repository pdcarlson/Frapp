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
  /**
   * Provenance tag for the row: `wikipedia` for rows built from Wikipedia's
   * chapter lists (`supabase/seed/chapter_directory.sources.json` records the
   * revisions), `seed` for the hand-written first seed, `retired` for a row
   * the seed dropped that a chapter still links (kept for the link, never
   * offered by search), else whoever curated it.
   */
  source: string;
  /** Other names a search should find the school by ("RPI"). Searched, never shown. */
  aliases: string[];
  /** Other names a search should find the organization by ("FIJI"). Searched, never shown. */
  org_aliases: string[];
  created_at: string;
  /**
   * The `search_*` columns are `GENERATED ALWAYS … STORED`: the normalized
   * text and names `search_chapter_directory` matches and ranks against
   * (20261107043000_chapter_directory_search.sql). No caller selects them and
   * they can never be written, but they are declared so this interface
   * describes the table as it actually is: `.eq`/`.order` are checked against
   * `keyof Row`, so an undeclared column is a compile error at those call
   * sites.
   */
  search_text: string;
  search_org_names: string[];
  search_chapter_names: string[];
  search_school_names: string[];
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

/**
 * vocab(key, chapterConfig) — returns the chapter-specific term for a
 * well-known vocabulary key, falling back to the IFC default.
 *
 * Usage:
 *   vocab("recruitment", config)   // → "Rush" / "Intake" / "Induction"
 *   vocab("pledge", config)        // → "New member" / "Aspirant" / "Candidate"
 *   vocab("class", config)         // → "Pledge class" / "Line" / "Cohort"
 */

export type VocabKey = "recruitment" | "pledge" | "class";

const IFC_DEFAULTS: Record<VocabKey, string> = {
  recruitment: "Rush",
  pledge:      "New member",
  class:       "Pledge class",
};

type VocabConfig = {
  vocabulary?: Record<string, string>;
};

export function vocab(key: VocabKey, chapterConfig?: VocabConfig): string {
  const override = chapterConfig?.vocabulary?.[key];
  if (override && typeof override === "string" && override.trim()) {
    return override.trim();
  }
  return IFC_DEFAULTS[key];
}

/**
 * Title-case every word in a vocab term, for callers that use it as a
 * role-name-style reference (e.g. "New Member" alongside "Member") rather
 * than inline sentence-case prose. `vocab()`'s own multi-word defaults are
 * sentence case — only the first word capitalized ("New member", "Pledge
 * class") — but the seeded role these terms describe is always displayed
 * fully capitalized elsewhere (e.g. the Discord-import role mapping step's
 * "New Member"), so a caller quoting the term as a proper noun should apply
 * this rather than assume `vocab()`'s casing.
 */
export function titleCase(term: string): string {
  return term
    .split(" ")
    .map((word) =>
      word ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

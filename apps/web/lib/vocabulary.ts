/**
 * vocab(key, chapterConfig) — returns the chapter-specific term for a
 * well-known vocabulary key, falling back to the IFC default.
 *
 * Usage:
 *   vocab("recruitment", config)   // → "Rush" / "Intake" / "Induction"
 *   vocab("pledge", config)        // → "New member" / "Aspirant" / "Candidate"
 *   vocab("class", config)         // → "Pledge class" / "Line" / "Cohort"
 */

import { getArchetype, VOCABULARY_DEFAULTS } from "@repo/org-archetypes";

export type VocabKey = "recruitment" | "pledge" | "class";

const IFC_DEFAULTS: Record<VocabKey, string> = {
  recruitment: "Rush",
  pledge:      "New member",
  class:       "Pledge class",
};

export type VocabConfig = {
  vocabulary?: Record<string, string>;
};

/** The two member-view fields a chapter's vocabulary is resolved from. */
export type MemberViewVocabulary = {
  org_archetype?: string | null;
  vocabulary?: Record<string, string> | null;
};

/**
 * A chapter's vocabulary from the member view (`GET /v1/chapters/current`),
 * shaped for `vocab()`. Any member can read the member view; the config read
 * (`useOrgConfig()`) needs `chapter-config:view`, which no seeded role below
 * President holds (#2957). The member view carries the stored `vocabulary`
 * column as-is, so this applies the merge `ChapterConfigService.getConfig`
 * does: the archetype's defaults, then the chapter's stored words. Without it
 * a chapter with no stored words would lose its archetype's `/intake`.
 * `undefined` until the read answers.
 */
export function memberViewVocabulary(
  chapter: MemberViewVocabulary | undefined,
): VocabConfig | undefined {
  if (!chapter) return undefined;
  return {
    vocabulary: {
      ...VOCABULARY_DEFAULTS[getArchetype(chapter.org_archetype ?? "ifc").key],
      ...(chapter.vocabulary ?? {}),
    },
  };
}

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

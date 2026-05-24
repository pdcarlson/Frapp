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

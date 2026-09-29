/**
 * The chapter mark: what stands for a chapter wherever the product shows its
 * identity in a small space (#2876). The web nav's chapter tile, the mobile
 * chat header, and the welcome message onboarding posts all read it from here,
 * so the precedence can't drift between them.
 *
 * Precedence, owned by `spec/behavior/branding.md` § Chapter mark:
 *
 * 1. the uploaded logo;
 * 2. the chapter's short name (`branding.short_name`, e.g. "FIJI");
 * 3. its Greek letters (`branding.greek_letters`), unless the chapter turned
 *    them off (`branding.show_greek_letters: false`);
 * 4. initials of the chapter name, where a surface needs something in the slot.
 *
 * Step 3's opt-out exists because some organizations don't display their
 * letters at all: by custom, Phi Gamma Delta (FIJI) chapters don't, and the
 * beta chapter is one. Opting out hides the letters everywhere; it doesn't
 * delete them, so turning them back on restores what was stored.
 *
 * Takes `branding` as loose `unknown` values on purpose. The column is `jsonb`,
 * every client reads it as a `Record<string, unknown>`, and a malformed value
 * (a number where a string belongs) has to fall through to the next step rather
 * than render.
 */

/** The branding keys the mark reads. Everything else in the object is ignored. */
export type ChapterMarkBranding =
  | {
      short_name?: unknown;
      greek_letters?: unknown;
      show_greek_letters?: unknown;
    }
  | null
  | undefined;

export type ChapterTextMarkSource = "short_name" | "greek_letters";

export type ChapterMark =
  | { kind: "logo"; url: string }
  | {
      kind: "text";
      text: string;
      source: ChapterTextMarkSource | "initials";
    };

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether the chapter shows its Greek letters. Absent means yes: every chapter
 * created before the setting existed shows them, as it always did. Only an
 * explicit `false` turns them off.
 */
export function greekLettersShown(branding: ChapterMarkBranding): boolean {
  return branding?.show_greek_letters !== false;
}

/**
 * The chapter's Greek letters, or null when it has none or has turned them off.
 * Every surface that would print the letters goes through this, never through
 * `branding.greek_letters` directly, which is what makes the opt-out hold
 * everywhere.
 */
export function displayedGreekLetters(
  branding: ChapterMarkBranding,
): string | null {
  if (!greekLettersShown(branding)) return null;
  return nonEmpty(branding?.greek_letters);
}

/**
 * Steps 2 and 3: the text mark a chapter chose, or null when it has neither a
 * short name nor Greek letters it shows. For a surface with no image slot (the
 * welcome message), or one that shows nothing rather than initials.
 */
export function chapterTextMark(
  branding: ChapterMarkBranding,
): { text: string; source: ChapterTextMarkSource } | null {
  const shortName = nonEmpty(branding?.short_name);
  if (shortName) return { text: shortName, source: "short_name" };
  const letters = displayedGreekLetters(branding);
  if (letters) return { text: letters, source: "greek_letters" };
  return null;
}

/**
 * Up to two initials of a chapter name: the first letter of each of the first
 * two words, or the first two letters of a one-word name. `"--"` for a blank
 * name, so the slot is never empty.
 */
export function chapterInitials(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return "--";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** The whole precedence, for a surface that always fills the slot. */
export function resolveChapterMark(input: {
  logoUrl?: string | null;
  branding: ChapterMarkBranding;
  name: string | null | undefined;
}): ChapterMark {
  const logoUrl = nonEmpty(input.logoUrl);
  if (logoUrl) return { kind: "logo", url: logoUrl };
  const text = chapterTextMark(input.branding);
  if (text) return { kind: "text", ...text };
  return { kind: "text", text: chapterInitials(input.name), source: "initials" };
}

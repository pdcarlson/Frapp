/**
 * Smart defaults for the chapter document upload panel: what the form can
 * fill in from the file alone, before anyone types.
 *
 * Every guess here is a starting value the officer can change, never a
 * verdict. AI autofill from the document's contents is parked in #3642; this
 * is the part that needs nothing but the file name.
 */

/**
 * The types offered before a chapter has used any of its own. `document_type`
 * is still free text on the wire (#3642 makes it a real list), so a chapter's
 * own earlier values are offered beside these by {@link documentTypeOptions}.
 */
export const DEFAULT_DOCUMENT_TYPES = [
  "Bylaws",
  "Minutes",
  "Agenda",
  "Budget",
  "Policy",
  "Form",
] as const;

/**
 * Filename words that point at a type, in the order they are tried. Checked as
 * whole words on the cleaned name, so "minutes" matches "Exec minutes 10-12"
 * but "form" does not match "formal" or "uniform".
 */
const TYPE_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Bylaws", ["bylaws", "bylaw", "constitution"]],
  ["Minutes", ["minutes", "mins"]],
  ["Agenda", ["agenda", "agendas"]],
  ["Budget", ["budget", "budgets", "financials", "finance"]],
  ["Policy", ["policy", "policies", "handbook", "guidelines"]],
  ["Form", ["form", "forms", "waiver", "application"]],
];

/**
 * A readable title from a file name: the extension dropped, separators turned
 * to spaces, the first letter capitalized and the rest left as typed, so
 * "fall-2026-bylaws-revision.pdf" reads "Fall 2026 bylaws revision" and
 * "IFC_Risk_Policy.docx" keeps its acronym as "IFC Risk Policy".
 */
export function titleFromFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const spaced = stem
    .replace(/[_]+/g, " ")
    // A hyphen is a separator unless it sits between two digits, where it is
    // part of a date ("10-12") and stays.
    .replace(/(?<!\d)-|-(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The type a file name points at, from `options` (so a chapter that already
 * spells it "By-Laws" gets its own spelling back), or `null` when the name
 * says nothing recognizable.
 */
export function guessDocumentType(
  fileName: string,
  options: readonly string[],
): string | null {
  const words = new Set(
    titleFromFilename(fileName)
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter(Boolean),
  );
  for (const [type, keywords] of TYPE_KEYWORDS) {
    if (!keywords.some((keyword) => words.has(keyword))) continue;
    const own = options.find(
      (option) => option.toLowerCase() === type.toLowerCase(),
    );
    return own ?? type;
  }
  // A chapter's own type named outright in the file name ("Rush schedule.pdf"
  // in a chapter that files "Schedule" documents).
  const own = options.find((option) =>
    option
      .toLowerCase()
      .split(/\s+/)
      .every((part) => words.has(part)),
  );
  return own ?? null;
}

/**
 * The type chips: the defaults, then every type the chapter has already used,
 * each once whatever its case. A chapter's own spelling replaces the default's
 * ("BYLAWS" stays "BYLAWS" if that is what the library says).
 */
export function documentTypeOptions(
  existing: ReadonlyArray<string | null | undefined>,
): string[] {
  const byKey = new Map<string, string>();
  for (const type of DEFAULT_DOCUMENT_TYPES) byKey.set(type.toLowerCase(), type);
  for (const raw of existing) {
    const type = raw?.trim();
    if (!type) continue;
    byKey.set(type.toLowerCase(), type);
  }
  return [...byKey.values()];
}

/**
 * The folder a document of `type` most likely belongs in: the folder the
 * chapter files most of that type under, or else a folder whose name says the
 * type ("Meeting Minutes" for Minutes, "Bylaws & Governance" for Bylaws,
 * "Finance" for Budget). `null` when neither points anywhere.
 */
export function suggestFolder(
  type: string,
  folders: readonly string[],
  documents: ReadonlyArray<{
    document_type: string | null;
    folder: string | null;
  }>,
): string | null {
  const key = type.toLowerCase();
  const counts = new Map<string, number>();
  for (const doc of documents) {
    if (!doc.folder || doc.document_type?.toLowerCase() !== key) continue;
    if (!folders.includes(doc.folder)) continue;
    counts.set(doc.folder, (counts.get(doc.folder) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [folder, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = folder;
  }
  if (best) return best;

  const words = new Set([
    key,
    ...(TYPE_KEYWORDS.find(([name]) => name.toLowerCase() === key)?.[1] ?? []),
  ]);
  return (
    folders.find((folder) =>
      folder
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((word) => words.has(word)),
    ) ?? null
  );
}

/**
 * The points ledger's category vocabulary, and the one place its tokens become
 * words.
 *
 * `point_transactions.category` is an enum (`ATTENDANCE | ACADEMIC | SERVICE |
 * FINE | MANUAL | STUDY`, `packages/api-sdk/src/types.ts`). It is not a status,
 * so `writing.md` §5's status label map doesn't hold it, and an ALL CAPS
 * token on screen read as a database column leaking through. The
 * leaderboard's transactions, the audit list, both category filters and the CSV
 * export all read this module, so a filter option and the row it matches can
 * never spell the same category two ways.
 */

/** Filter order: the automatic sources first, then the officer-made ones. */
export const POINT_CATEGORIES = [
  "ATTENDANCE",
  "ACADEMIC",
  "STUDY",
  "SERVICE",
  "FINE",
  "MANUAL",
] as const;

export type PointCategory = (typeof POINT_CATEGORIES)[number];

const LABELS: Record<PointCategory, string> = {
  ATTENDANCE: "Attendance",
  ACADEMIC: "Academic",
  STUDY: "Study",
  SERVICE: "Service",
  FINE: "Fine",
  MANUAL: "Manual",
};

function isPointCategory(value: string): value is PointCategory {
  return (POINT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The sentence-case label for a category token.
 *
 * `null` for a missing category, so a meta line drops the clause rather than
 * printing a placeholder (`spec/ui/web-dashboard/README.md` § Page grammar: an
 * absent value is absent). A token this module has never seen, which a newer
 * API could send before the web app ships, is sentence-cased rather than shown
 * raw, so it still reads as a word.
 */
export function pointCategoryLabel(
  category: string | null | undefined,
): string | null {
  if (typeof category !== "string") return null;
  const token = category.trim().toUpperCase();
  if (!token) return null;
  if (isPointCategory(token)) return LABELS[token];
  const words = token.toLowerCase().replace(/_+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

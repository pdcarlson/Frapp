import { parseGuardedInt } from "@/lib/utils";

/**
 * Why a whole-number text draft can't be saved, as toast copy, or `null` when
 * it reads as an integer >= `min`. The drafts are guarded on every keystroke
 * (`guardIntDraft`), so a field may be empty or under its floor mid-edit; this
 * is where that floor is enforced (#3050). Copy: `writing.md` § Settings.
 */
export function intDraftRefusal(
  draft: string,
  min: number,
  label: string,
): { title: string; description: string } | null {
  if (parseGuardedInt(draft, min) !== undefined) return null;
  return {
    title:
      draft.trim() === ""
        ? `${label} needs a number`
        : `${label} starts at ${min}`,
    description: `Enter a whole number of ${min} or more.`,
  };
}

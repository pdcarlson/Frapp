import type { ActivityBadgeVariant } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";

/**
 * The status hue an Activity row's badge takes on the phone, for
 * `StatusChip`, as web hands the same variant to its `Badge`. `outline` is
 * quiet metadata ("To do", "Required", "Closed"), drawn in the muted text
 * colour as the task card draws a task not yet started. `warning`, an ask,
 * never reaches a `StatusChip`: both clients draw it as the action it opens
 * (`ActivityAsk`: the phone's in `components/activity/activity-row.tsx`,
 * web's in `apps/web/components/activity/activity-row-lead.tsx`; #4173); its case
 * stays so the map is total.
 */
export function activityBadgeHue(
  variant: ActivityBadgeVariant,
  tokens: SignetTokens,
): string {
  switch (variant) {
    case "success":
      return tokens.color.semantic.success;
    case "warning":
      return tokens.color.semantic.warning;
    case "destructive":
      return tokens.color.semantic.destructive;
    case "outline":
      return tokens.color.text.mutedForeground;
  }
}

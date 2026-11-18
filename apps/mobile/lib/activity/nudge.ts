import type { ActivityNudge, ActivityNudgeCard } from "@repo/hooks";
import { memberNudgeAskPrompt } from "@repo/validation";

/**
 * The card and tray without the week card's Next (#5464): Paul's rule is no
 * screen telling the same thing twice, and Next already holds that item with
 * its one filled button. A row's key ends in the id the card names
 * (`needs:task:<id>`, `coming:event:<id>`, `needs:card:<messageId>`), so a
 * match moves the tray's first item up into the card.
 */
export function withoutWeekNext(
  data: ActivityNudgeCard | undefined,
  nextKey: string | null,
): ActivityNudgeCard | null {
  if (!data?.card) return null;
  const isNext = (item: ActivityNudge) =>
    nextKey !== null &&
    item.target_id !== null &&
    nextKey.endsWith(`:${item.target_id}`);
  const items = [data.card, ...data.tray].filter((item) => !isNext(item));
  const [card, ...tray] = items;
  return card ? { card, tray } : null;
}

/**
 * Whether a sheet that just closed was for something the card or its tray
 * names, so the card is worth asking for again (the member may have done
 * it). Any other sheet leaves the card as it was, and asking costs a read of
 * everything Activity holds.
 */
export function nudgeShowsRow(
  data: ActivityNudgeCard | null,
  rowKey: string | null,
): boolean {
  if (!data?.card || rowKey === null) return false;
  return [data.card, ...data.tray].some(
    (item) => item.target_id !== null && rowKey.endsWith(`:${item.target_id}`),
  );
}

/**
 * What "Ask about this" puts in Ask's box for the member to send or change:
 * a task's own question (#4781), or the card's thing by name.
 */
export function activityNudgeAskPrompt(item: ActivityNudge): string {
  if (item.target_type === "task") return memberNudgeAskPrompt(item.headline);
  return `What should I know about ${item.headline.trim()}?`;
}

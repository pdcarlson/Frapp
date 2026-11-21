import type { ActivityNudge, ActivityNudgeCard } from "@repo/hooks";
import { memberNudgeAskPrompt } from "@repo/validation";

/**
 * The card and tray without an event the Now card above already holds
 * (#5777), by its id in `onNowIds`: Paul's rule is no screen telling the same
 * thing twice, so a match moves the tray's first item up into the card. (The
 * week card's Next it once also stepped around left with that card, #5779.)
 */
export function withoutNowEvents(
  data: ActivityNudgeCard | undefined,
  onNowIds: readonly string[] = [],
): ActivityNudgeCard | null {
  if (!data?.card) return null;
  const isOnNow = (item: ActivityNudge) =>
    item.target_type === "event" &&
    item.target_id !== null &&
    onNowIds.includes(item.target_id);
  const items = [data.card, ...data.tray].filter((item) => !isOnNow(item));
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

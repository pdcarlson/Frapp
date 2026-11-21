import {
  ACTIVITY_CARD_KEYS,
  ACTIVITY_LAYOUT_MAX_KEYS,
  can,
  isActivityCardKey,
  type ActivityCardKey,
} from "@repo/validation";

/**
 * How a member's Activity cards are arranged (#5520; Paul's pick, 2026-11-18:
 * a stack of cards each member orders and hides, Bevel's Edit Home). The rule
 * is `spec/behavior/activity.md` § Cards; both apps draw from this model so
 * the phone and web show one page.
 */

/** What `GET /v1/activity/layout` returns, and what `PUT` takes (less `saved`). */
export type ActivityLayoutRead = {
  card_order: string[];
  hidden_cards: string[];
  /** False until the member first saves: the role's default applies. */
  saved: boolean;
};

/**
 * Cards a member may move but not hide. To do is the list the week ring's
 * lines narrow; hidden, they would act on nothing.
 */
export const ACTIVITY_UNHIDEABLE_CARDS: readonly ActivityCardKey[] = ["todo"];

/** Whether a member may hide this card. */
export function canHideActivityCard(key: ActivityCardKey): boolean {
  return !ACTIVITY_UNHIDEABLE_CARDS.includes(key);
}

/** Which default a member starts from. */
export type ActivityCardRole = "officer" | "member";

/** The cards in the order the page draws them, and the ones the member hid. */
export type ActivityCardArrangement = {
  shown: ActivityCardKey[];
  hidden: ActivityCardKey[];
};

/**
 * The default order for each role. Since #5779 (Paul's direction A,
 * 2026-11-20) both start the same: the Frapp card, the member's own To do,
 * then Running, which an officer's approvals lead. Every card is listed,
 * since a card with nothing in it draws nothing: a member with nothing
 * running never sees an empty Running.
 */
export const ACTIVITY_DEFAULT_CARD_ORDER: Record<
  ActivityCardRole,
  readonly ActivityCardKey[]
> = {
  officer: ["nudge", "todo", "running"],
  member: ["nudge", "todo", "running"],
};

/**
 * An officer, for the default, is anyone who can confirm tasks or approve
 * hours: the people To review is for.
 */
export function activityCardRole(
  permissions: readonly string[] | undefined | null,
): ActivityCardRole {
  const held = permissions ?? [];
  return can("tasks:manage", held) || can("service:approve", held)
    ? "officer"
    : "member";
}

/** The cards Running replaced (#5779), as a save from before it names them. */
const RUNNING_TOOK: readonly string[] = ["review", "waiting"];

/**
 * The page's cards, from what the member saved and their role's default.
 *
 * - Nothing saved (or the read not back yet): the role's default, nothing hidden.
 * - Saved: their order and their hidden cards. A key this build doesn't know
 *   is skipped (a newer client saved it). A card this build knows that they
 *   never placed, because it is newer than their save, goes where the
 *   default puts it: after the nearest card before it in the default that
 *   they show.
 * - Running took To review and Waiting on others in (#5779), so a save from
 *   before it that never placed Running places it where the first of those
 *   was shown, or hides it when they hid both.
 */
export function arrangeActivityCards(
  layout: ActivityLayoutRead | null | undefined,
  role: ActivityCardRole,
): ActivityCardArrangement {
  const defaults = ACTIVITY_DEFAULT_CARD_ORDER[role];
  if (!layout?.saved) return { shown: [...defaults], hidden: [] };

  const placesRunning =
    layout.card_order.includes("running") ||
    layout.hidden_cards.includes("running");
  const asRunning = (key: string) =>
    !placesRunning && RUNNING_TOOK.includes(key) ? "running" : key;
  const order = layout.card_order.map(asRunning);
  const hiddenKeys = layout.hidden_cards.map(asRunning);
  const hidden = unique(
    hiddenKeys
      .filter(isActivityCardKey)
      .filter(canHideActivityCard)
      // Shown in place of one of them, so not hidden for the other.
      .filter(
        (k) => placesRunning || k !== "running" || !order.includes("running"),
      ),
  );
  const hiddenSet = new Set<ActivityCardKey>(hidden);
  const shown = unique(
    order.filter(isActivityCardKey).filter((k) => !hiddenSet.has(k)),
  );
  for (const key of defaults) {
    if (shown.includes(key) || hiddenSet.has(key)) continue;
    insertAtDefault(shown, key, defaults);
  }
  return { shown, hidden };
}

/** Move a shown card one place up or down. Off the end is no change. */
export function moveActivityCard(
  arrangement: ActivityCardArrangement,
  key: ActivityCardKey,
  direction: -1 | 1,
): ActivityCardArrangement {
  const shown = [...arrangement.shown];
  const at = shown.indexOf(key);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= shown.length) return arrangement;
  [shown[at], shown[to]] = [shown[to]!, shown[at]!];
  return { shown, hidden: arrangement.hidden };
}

/** Hide a shown card. Hidden cards are listed most recently hidden first. */
export function hideActivityCard(
  arrangement: ActivityCardArrangement,
  key: ActivityCardKey,
): ActivityCardArrangement {
  if (!arrangement.shown.includes(key) || !canHideActivityCard(key)) {
    return arrangement;
  }
  return {
    shown: arrangement.shown.filter((k) => k !== key),
    hidden: [key, ...arrangement.hidden.filter((k) => k !== key)],
  };
}

/** Bring a hidden card back, where the role's default puts it. */
export function showActivityCard(
  arrangement: ActivityCardArrangement,
  key: ActivityCardKey,
  role: ActivityCardRole,
): ActivityCardArrangement {
  if (!arrangement.hidden.includes(key)) return arrangement;
  const shown = [...arrangement.shown];
  insertAtDefault(shown, key, ACTIVITY_DEFAULT_CARD_ORDER[role]);
  return { shown, hidden: arrangement.hidden.filter((k) => k !== key) };
}

/** Whether two arrangements draw the same page. */
export function sameActivityArrangement(
  a: ActivityCardArrangement,
  b: ActivityCardArrangement,
): boolean {
  return (
    a.shown.join() === b.shown.join() && a.hidden.join() === b.hidden.join()
  );
}

/**
 * What `PUT /v1/activity/layout` takes for an arrangement.
 *
 * The PUT replaces the whole row, so keys this build doesn't know (a newer
 * client's cards) are carried over from what was stored: a hidden one stays
 * hidden, and a shown one keeps its place after the card it followed. Without
 * this, saving on an older phone would bring back a card hidden on web.
 */
export function activityLayoutBody(
  arrangement: ActivityCardArrangement,
  stored?: ActivityLayoutRead | null,
): { card_order: string[]; hidden_cards: string[] } {
  const card_order: string[] = [...arrangement.shown];
  const hidden_cards: string[] = [...arrangement.hidden];
  if (stored?.saved) {
    const placed = new Set<string>([...card_order, ...hidden_cards]);
    // The card each unknown key followed, or the last unknown key put after it.
    let after: string | null = null;
    for (const key of stored.card_order) {
      if (isActivityCardKey(key)) {
        if (card_order.includes(key)) after = key;
        continue;
      }
      if (placed.has(key)) continue;
      card_order.splice(
        after === null ? 0 : card_order.indexOf(after) + 1,
        0,
        key,
      );
      placed.add(key);
      after = key;
    }
    for (const key of stored.hidden_cards) {
      if (isActivityCardKey(key) || placed.has(key)) continue;
      hidden_cards.push(key);
      placed.add(key);
    }
  }
  return {
    card_order: card_order.slice(0, ACTIVITY_LAYOUT_MAX_KEYS),
    hidden_cards: hidden_cards.slice(0, ACTIVITY_LAYOUT_MAX_KEYS),
  };
}

function insertAtDefault(
  shown: ActivityCardKey[],
  key: ActivityCardKey,
  defaults: readonly ActivityCardKey[],
): void {
  const order = defaults.includes(key) ? defaults : ACTIVITY_CARD_KEYS;
  const before = order.slice(0, order.indexOf(key)).reverse();
  const anchor = before.find((k) => shown.includes(k));
  shown.splice(anchor === undefined ? 0 : shown.indexOf(anchor) + 1, 0, key);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * Each card's name and what it holds, as Edit Activity lists them on both
 * apps. The names are the page's own section names.
 */
export const ACTIVITY_CARD_COPY: Record<
  ActivityCardKey,
  { name: string; detail: string }
> = {
  nudge: { name: "Frapp card", detail: "The one thing worth doing next" },
  todo: {
    name: "To do",
    detail: "Your events, tasks, polls and reminders, by day",
  },
  running: {
    name: "Running",
    detail: "What waits for your OK, and what you assigned, made or posted",
  },
};

/** The Now card's line in Edit Activity: always first, never hidden. */
export const ACTIVITY_NOW_CARD_COPY = {
  name: "Now",
  detail: "The event on right now. Always first.",
};

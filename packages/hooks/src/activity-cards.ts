import {
  ACTIVITY_CARD_KEYS,
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
 * Cards a member may move but not hide. To do is the list the week card's
 * lines narrow and the week strip's days jump to; hidden, both would act on
 * nothing.
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
 * The default order for each role. A member's own work leads; an officer's
 * queue for their OK comes before it, and what is out with others follows,
 * as the concept Paul picked drew them. Every card is listed, since a card
 * with nothing in it draws nothing: a member never sees an empty To review.
 */
export const ACTIVITY_DEFAULT_CARD_ORDER: Record<
  ActivityCardRole,
  readonly ActivityCardKey[]
> = {
  officer: [
    "nudge",
    "recap",
    "review",
    "todo",
    "calendar",
    "waiting",
    "semester",
    "reminders",
    "links",
  ],
  member: [
    "nudge",
    "recap",
    "todo",
    "calendar",
    "semester",
    "reminders",
    "waiting",
    "links",
    "review",
  ],
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

/**
 * The page's cards, from what the member saved and their role's default.
 *
 * - Nothing saved (or the read not back yet): the role's default, nothing hidden.
 * - Saved: their order and their hidden cards. A key this build doesn't know
 *   is skipped (a newer client saved it). A card this build knows that they
 *   never placed, because it is newer than their save, goes where the
 *   default puts it: after the nearest card before it in the default that
 *   they show.
 */
export function arrangeActivityCards(
  layout: ActivityLayoutRead | null | undefined,
  role: ActivityCardRole,
): ActivityCardArrangement {
  const defaults = ACTIVITY_DEFAULT_CARD_ORDER[role];
  if (!layout?.saved) return { shown: [...defaults], hidden: [] };

  const hidden = unique(
    layout.hidden_cards.filter(isActivityCardKey).filter(canHideActivityCard),
  );
  const hiddenSet = new Set<ActivityCardKey>(hidden);
  const shown = unique(
    layout.card_order
      .filter(isActivityCardKey)
      .filter((k) => !hiddenSet.has(k)),
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

/** What `PUT /v1/activity/layout` takes for an arrangement. */
export function activityLayoutBody(arrangement: ActivityCardArrangement): {
  card_order: string[];
  hidden_cards: string[];
} {
  return {
    card_order: [...arrangement.shown],
    hidden_cards: [...arrangement.hidden],
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
  recap: { name: "Last week", detail: "What you did, Sunday to Tuesday" },
  review: {
    name: "To review",
    detail: "Finished tasks and hours waiting for your OK",
  },
  todo: { name: "To do", detail: "Your events, tasks and polls, by day" },
  calendar: { name: "Calendar", detail: "The chapter's month" },
  reminders: {
    name: "Reminders",
    detail: "Messages you asked to be reminded of",
  },
  waiting: {
    name: "Waiting on others",
    detail: "What you assigned, posted or made",
  },
  links: { name: "Links", detail: "Sign-ups posted for you" },
  semester: {
    name: "This semester",
    detail: "Points, events, service and study",
  },
};

/** The week card's line in Edit Activity: always first, never hidden. */
export const ACTIVITY_WEEK_CARD_COPY = {
  name: "This week",
  detail: "The week, its ring and what's next. Always first.",
};

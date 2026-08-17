/**
 * The member-facing notification categories, shared so every surface offers the
 * same switches under the same names.
 *
 * Shared rather than per-app because the rows are a *contract with the server*,
 * not a display list: each `key` is written verbatim into
 * `notification_preferences.category` and read back by
 * `NotificationService.notifyUser`. Nothing validates that string —
 * the column is `text` with no CHECK, and the DTO only checks
 * `@IsString() @MaxLength(100)` — so a typo in a surface silently creates a
 * preference row that suppresses nothing, forever. One catalog is what makes
 * that typo a compile error instead.
 *
 * ## What the API actually emits
 *
 * Grepping `category: '…'` across `apps/api/src` yields eight distinct values.
 * Six are here. The other two are deliberately absent:
 *
 * - **`announcements`** — the delivery flow checks the member's preference
 *   *before* it checks priority (`notification.service.ts`), so switching this
 *   off suppresses URGENT chapter announcements **and** the in-app row, not just
 *   the push. #564 assumes URGENT is exempt; on this server it is not. Exposing
 *   the row would let a member silently mute an emergency broadcast from a
 *   settings screen. It ships once the server exempts URGENT from the
 *   preference gate.
 * - **`admin`** — "new member joined" / "invite accepted" / "role change". It is
 *   member-facing in *delivery* (`InviteService` sends it through
 *   `notifyChapter`, so every member gets a row), but it is chapter operations
 *   rather than something a member opts into per-category, and it has no drawn
 *   row in the reference.
 *
 * `default` is the fallback the service substitutes when a payload omits a
 * category — never a member preference. There is no `study` category at all
 * despite `spec/behavior/notifications.md` listing three Study triggers; those
 * are local notifications fired on-device, and `StudyService` calls neither
 * `notifyUser` nor `notifyChapter`.
 *
 * ## `defaultEnabled` is not read off the trigger table
 *
 * That table carries *priority*, not defaults, and no migration seeds preference
 * rows. The real default comes from two places that agree: the column default
 * (`is_enabled boolean not null default true`) and the row-absent branch of the
 * gate, which only suppresses on `pref && !pref.is_enabled` — so an absent row
 * means enabled. Every category is therefore opt-*out*, and this field exists to
 * render an accurate switch before the first `GET` lands, not to encode a policy
 * of its own.
 *
 * Web's Profile grid adopting this catalog is the other half of #564.
 */

/** One member-facing category, as drawn: a switch with a label and a hint. */
export interface NotificationCategory {
  /** Written verbatim to `notification_preferences.category`. */
  key: string;
  /** Switch label. Sentence case, per `spec/ui/design-system/writing.md`. */
  label: string;
  /** One line under the label naming what actually arrives. */
  description: string;
  /**
   * What to show before the member's rows load. Always `true` today — see the
   * module docblock for why that is derived from the server, not chosen here.
   */
  defaultEnabled: boolean;
}

export const NOTIFICATION_CATEGORIES = [
  {
    key: "chat",
    label: "Chat",
    // The coarse switch. Per-channel and per-kind levels are a separate
    // tri-state in `chat_notification_preferences` (ADR-06) that the push
    // worker resolves *after* this gate, so turning this off silences chat
    // regardless of what those say.
    description: "Mentions, direct messages, and new messages in your channels.",
    defaultEnabled: true,
  },
  {
    key: "events",
    label: "Events",
    description: "Event reminders, new events, and time or location changes.",
    defaultEnabled: true,
  },
  {
    key: "points",
    label: "Points",
    description: "Points awarded, fines, and leaderboard movement.",
    defaultEnabled: true,
  },
  {
    key: "billing",
    label: "Billing",
    // Impure, knowingly: `BillingService` sends URGENT "subscription status
    // changed" alerts to the chapter president on this same key, so a president
    // who switches billing off also silences those. Splitting them needs a
    // second category server-side.
    description: "Invoices created, dues coming due, and payments received.",
    defaultEnabled: true,
  },
  {
    key: "tasks",
    label: "Tasks",
    description: "Tasks assigned to you, due soon, overdue, or completed.",
    defaultEnabled: true,
  },
  {
    key: "service",
    label: "Service hours",
    description: "Approvals and rejections on service entries you submit.",
    defaultEnabled: true,
  },
] as const satisfies readonly NotificationCategory[];

/** The `key` of a category a member can actually switch. */
export type NotificationCategoryKey =
  (typeof NOTIFICATION_CATEGORIES)[number]["key"];

const CATEGORY_KEYS: ReadonlySet<string> = new Set(
  NOTIFICATION_CATEGORIES.map((category) => category.key),
);

/**
 * Whether `value` is a category this catalog exposes.
 *
 * Needed because `GET /v1/notifications/preferences` returns whatever rows exist
 * — including categories this catalog does not list (an `announcements` row
 * written by an older client, say) and, since the column is unconstrained,
 * anything else a caller has ever `PATCH`ed. A surface folding those rows into
 * its switch state must drop the ones it has no switch for rather than
 * widening its own state to match the server.
 */
export function isNotificationCategoryKey(
  value: unknown,
): value is NotificationCategoryKey {
  return typeof value === "string" && CATEGORY_KEYS.has(value);
}

/**
 * The catalog's defaults as a plain map — the starting point a surface folds
 * server rows onto, and what it renders while the first `GET` is in flight.
 */
export function defaultNotificationCategoryState(): Record<
  NotificationCategoryKey,
  boolean
> {
  const state = {} as Record<NotificationCategoryKey, boolean>;
  for (const category of NOTIFICATION_CATEGORIES) {
    state[category.key] = category.defaultEnabled;
  }
  return state;
}

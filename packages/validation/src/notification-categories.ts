import { isBetaOffModule } from "./beta-off-modules";

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
 * Five are here. The other three are deliberately absent:
 *
 * - **`chat`** — dropped as a switch on 2026-11-06 (the owner's iOS testing:
 *   "Do we really want users to be able to turn off chat?"). It silenced every
 *   chat push at once, DMs and @mentions included, which is how a member
 *   misses the message that mattered and blames the app. Chat is tuned where
 *   the noise is instead: a level per channel and per DM
 *   (`chat_notification_preferences`, ADR-06), set from the conversation, plus
 *   quiet hours for the night. The server stops honouring the switch too, so a
 *   row an older build wrote can't keep a member muted with no control left to
 *   undo it: `NotificationService` reads a preference only for a key in this
 *   catalog (`isNotificationCategoryKey`).
 *
 * - **`announcements`** — still absent, but for a different reason than it used
 *   to be. The old blocker was gate ordering: the preference was checked before
 *   priority, so the switch would have muted URGENT broadcasts. That is fixed —
 *   `notifyUser` now exempts URGENT from this gate entirely (#1041), which is
 *   what #564 always assumed. What replaces it is that the category has no
 *   non-URGENT traffic to switch: its one emitter, the chat push worker, sends
 *   every push its announcement predicate matches as URGENT
 *   (`isAnnouncementPush` in `chat-push-worker.service.ts`, which defers to
 *   `isAnnouncementChannel`: a public, read-only channel whose name contains
 *   `announcements`). `ChatService` sends no push of its own (#2771). So a
 *   preference row here would suppress nothing — the exact dead-control
 *   failure the first paragraph of this docblock exists to prevent. It ships
 *   once routine announcements are distinguishable from emergency ones; see
 *   #1323. (Earlier versions of this docblock named `chat.service.ts` as an
 *   emitter and a `kind` arm in the predicate; neither exists any more.)
 * - **`admin`** — "new member joined" / "invite accepted" / "role change", and
 *   "message reported" to the officers who can open the chat report queue
 *   (`ChatReportService`, via `notifyUser`). It is member-facing in *delivery*
 *   (`InviteService` sends it through `notifyChapter`, so every member gets a
 *   row), but it is chapter operations rather than something a member opts into
 *   per-category, and it has no drawn row in the reference. The report alert
 *   uses it rather than `chat` for the same reason: it is moderation work, not
 *   a message.
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
 * Both surfaces now draw from here — mobile's s16 grid and web's Profile
 * Notifications card — which is what #564 closed. Anything that renders these
 * switches maps this array; nothing hand-writes a second list of keys. Web
 * draws each as a switch with its label and `description`; mobile s16 draws
 * the label only (`apps/mobile/app/(app)/preferences.tsx` says why).
 */

/** One member-facing category: a switch's key, label and hint. */
export interface NotificationCategory {
  /** Written verbatim to `notification_preferences.category`. */
  key: string;
  /** Switch label. Sentence case, per `spec/ui/design-system/writing.md`. */
  label: string;
  /**
   * One line naming what actually arrives, drawn under the label on web's
   * Profile card. Mobile s16 leaves it off.
   */
  description: string;
  /**
   * What to show before the member's rows load. Always `true` today — see the
   * module docblock for why that is derived from the server, not chosen here.
   */
  defaultEnabled: boolean;
}

export const NOTIFICATION_CATEGORIES = [
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
    // `BillingService` sends URGENT "subscription status changed" alerts to
    // the chapter president on this same key. Those used to be silenced along
    // with everything else when a president switched billing off; since #1041
    // URGENT bypasses the preference gate, so this switch now governs only the
    // routine invoice and dues traffic it advertises. No second server-side
    // category is needed.
    // While dues is beta-off nothing this switch governs is sent, so
    // `shownNotificationCategories` leaves the row out.
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
 * The categories a surface draws a switch for. `billing` is left out while
 * dues is beta-off (`spec/product/modules.md` § Beta-off modules): URGENT
 * subscription alerts bypass the preference gate, so the switch would govern
 * only invoice and dues pushes, and none are sent. The stored preference is
 * kept and still saved; only the row is hidden. Read at render time, not at
 * import, so specs can empty the beta list.
 */
export function shownNotificationCategories(): readonly (typeof NOTIFICATION_CATEGORIES)[number][] {
  return NOTIFICATION_CATEGORIES.filter(
    (category) => category.key !== "billing" || !isBetaOffModule("dues"),
  );
}

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

/** Every switch's position, complete — never a patch over some other state. */
export type NotificationCategoryState = Record<
  NotificationCategoryKey,
  boolean
>;

/**
 * The catalog's defaults as a plain map — the starting point a surface folds
 * server rows onto, and what it renders while the first `GET` is in flight.
 */
export function defaultNotificationCategoryState(): NotificationCategoryState {
  const state = {} as NotificationCategoryState;
  for (const category of NOTIFICATION_CATEGORIES) {
    state[category.key] = category.defaultEnabled;
  }
  return state;
}

/**
 * Fold `GET /v1/notifications/preferences` rows over the catalog defaults.
 *
 * A category with no row is enabled, because that is what the server does with
 * an absent row (`notification.service.ts` suppresses only on an explicit
 * `is_enabled: false`, and no migration seeds rows) — so this returns a
 * **complete** state rather than a patch, and a category the member has never
 * touched reads here exactly as it behaves in delivery.
 *
 * Takes `unknown` on purpose. `GET /v1/notifications/preferences` declares no
 * response schema, so the SDK types the body loosely and every caller is
 * narrowing anyway; doing it here once means no surface hand-rolls the checks.
 * Rows for categories outside the catalog are dropped per
 * {@link isNotificationCategoryKey} — the column is unconstrained `text`, so a
 * stale `announcements` row or anything else previously `PATCH`ed must not
 * widen a surface's state beyond the switches it draws.
 *
 * Shared rather than per-surface for the reason in this module's docblock: web
 * and mobile fold the same rows onto the same catalog, and a second copy is how
 * the two drift into disagreeing about what a member's switches say.
 */
export function rowsToNotificationCategoryState(
  rows: unknown,
): NotificationCategoryState {
  const state = defaultNotificationCategoryState();
  if (!Array.isArray(rows)) return state;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { category, is_enabled: isEnabled } = row as Record<string, unknown>;
    if (typeof isEnabled !== "boolean") continue;
    if (isNotificationCategoryKey(category)) state[category] = isEnabled;
  }
  return state;
}

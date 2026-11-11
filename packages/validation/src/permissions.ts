/**
 * Client-side permission gates.
 *
 * The API is the source of truth for RBAC; these helpers only answer "does the
 * caller's already-flattened permission set include the permission string this
 * component needs?". They exist so a surface can hide an affordance the server
 * would reject anyway — never to grant anything.
 *
 * **Shared, deliberately.** These lived in `apps/web/lib/auth/can.ts` and moved
 * here when mobile needed the same gate for the s22 host check-in screen
 * (#994). The wildcard rule has to match the server's `PermissionsGuard`
 * exactly, and a per-app copy is how that drifts: a mobile-local
 * `permissions.includes("events:update")` would silently lock out every owner,
 * whose grant is `*`.
 */

export const WILDCARD_PERMISSION = "*";

/**
 * Does `permissions` grant `required`?
 *
 * - `undefined` / empty array → always `false` (fail-safe closed).
 * - Wildcard `*` in `permissions` short-circuits to `true`.
 */
export function can(
  required: string,
  permissions: readonly string[] | null | undefined,
): boolean {
  if (!permissions || permissions.length === 0) return false;
  if (permissions.includes(WILDCARD_PERMISSION)) return true;
  return permissions.includes(required);
}

/**
 * Does `permissions` grant **all** the listed `required` permissions? Empty
 * `required` returns `true` (matches the server guard's behavior where an
 * endpoint with no required permissions is always accessible).
 */
export function canAll(
  required: readonly string[],
  permissions: readonly string[] | null | undefined,
): boolean {
  if (required.length === 0) return true;
  if (!permissions || permissions.length === 0) return false;
  if (permissions.includes(WILDCARD_PERMISSION)) return true;
  return required.every((perm) => permissions.includes(perm));
}

/**
 * Does `permissions` grant **any** of the listed `required` permissions? Empty
 * `required` returns `false` — "any of nothing" grants nothing.
 */
export function canAny(
  required: readonly string[],
  permissions: readonly string[] | null | undefined,
): boolean {
  if (required.length === 0) return false;
  if (!permissions || permissions.length === 0) return false;
  if (permissions.includes(WILDCARD_PERMISSION)) return true;
  return required.some((perm) => permissions.includes(perm));
}

/**
 * What it takes to open the chat report queue (#2257, #2311): `members:view`
 * **and** `channels:manage`, or the wildcard.
 *
 * **The one spelling of that union**, shared because several places have to
 * agree on it and a copy in each is how they drift. This is the one list of
 * them; `ChatReportController`'s docblock points here rather than repeating it.
 *
 * Code that reads it:
 *
 * - the API routes — `ChatReportController`'s class-level `members:view` plus
 *   the handler-level `channels:manage` on the officer routes, which
 *   `PermissionsGuard` ANDs. `chat-report.controller.spec.ts` pins that the
 *   decorators' union equals this list;
 * - who the API pages about a new report (`REPORT_QUEUE_PERMISSIONS` in
 *   `chat-report.service.ts` is this constant), so nobody is told about a queue
 *   that answers them 403;
 * - the web queue's `<Can allOf>` gate (`chat-reports-card.tsx`), so an officer
 *   holding one half is shown why rather than a Retry that can only ever 403.
 *
 * Prose that restates it in words, and changes with it by hand: the card's
 * permission-denied copy (`chatReportCopy.deniedDescription` in
 * `chat-report-copy.ts`, pinned against this list by its spec), `writing.md`
 * §7's Chat Admin row, the Status line, § Report and § Officer action of
 * `spec/behavior/chat/README.md`, and the `chat/reports` row of
 * `docs/security/authorization-model.md`.
 */
export const CHAT_REPORT_QUEUE_PERMISSIONS = [
  "members:view",
  "channels:manage",
] as const;

/**
 * Who is told a member joined the chapter (#3656), and so who gets the
 * "Someone joins the chapter" notification switch (#4008): whoever can open the roster the push
 * links to (`members:view`) **and** can act on the join, by inviting more
 * people (`members:invite`) or by giving the new member a role
 * (`roles:manage`). Any one set admits a member; the wildcard admits all.
 *
 * **The one spelling**, so the push and the switch can't drift: a member shown
 * a switch for a push they never get, or getting a push with no switch.
 *
 * Code that reads it:
 *
 * - who the API pushes about a join (`InviteService.redeem`, through
 *   `RbacService.findUserIdsWithAnyPermissions`);
 * - the `members` row of `NOTIFICATION_CATEGORIES`, whose `audience` is this
 *   list, so `shownNotificationCategories` draws the switch only for them.
 *
 * Prose that restates it: the "New member joined" row of the trigger table in
 * `spec/behavior/notifications.md`.
 */
export const MEMBER_JOINED_AUDIENCE: readonly (readonly string[])[] = [
  ["members:view", "members:invite"],
  ["members:view", "roles:manage"],
];

/** Does `permissions` satisfy every permission in at least one of `sets`? */
export function canAllOfAny(
  sets: readonly (readonly string[])[],
  permissions: readonly string[] | null | undefined,
): boolean {
  if (!permissions || permissions.length === 0) return false;
  return sets.some((set) => set.length > 0 && canAll(set, permissions));
}

/**
 * What it takes to edit the chapter's profile, accent and logo (#2575):
 * `chapter-config:view` **and** `chapter-config:manage`, or the wildcard. That
 * covers the name, university, donation URL and accent through
 * `PATCH /v1/chapters/current`, and the logo through its upload and delete
 * routes.
 *
 * `chapter-config:manage`, because the profile is chapter configuration; and
 * with `chapter-config:view`, like every other route that permission gates,
 * because the Settings tabs these edits live on need `view` to show at all
 * (`isSettingsTabVisible` in `apps/web`, and the `GET /chapters/:id/config`
 * read they wait on). A role holding `manage` alone could otherwise save
 * through the API from tabs it is never shown. `spec/behavior/rbac.md` records
 * the rule.
 *
 * Until #2575 the API admitted `roles:manage` or `billing:manage` while the
 * Settings page gated on `chapter-config:manage`, so the default Treasurer could
 * save through the API but not the page.
 *
 * **The one spelling**, so the two sides can't drift again. Code that reads it:
 *
 * - `ChapterController`'s `update`, `requestLogoUploadUrl`,
 *   `confirmLogoUpload` and `deleteLogo` routes, whose decorators
 *   `chapter.controller.spec.ts` pins to it;
 * - the Settings page's profile and accent saves (`settings-page.tsx`,
 *   `canEditProfile`), pinned by `settings-profile-permission.spec.tsx`;
 * - the profile card's permission hint (`settings-org-tab.tsx`, `profileHint`),
 *   which names these permissions to a member who lacks them.
 *
 * Prose that restates it: `spec/behavior/rbac.md`'s `chapter-config:manage`
 * row, `spec/behavior/chapter-config.md` § "PATCH /chapters/current — core
 * chapter profile", the `chapters/current` row of
 * `docs/security/authorization-model.md`, and the #930 section of
 * `docs/security/security-fixes.md`.
 */
export const CHAPTER_PROFILE_PERMISSIONS = [
  "chapter-config:view",
  "chapter-config:manage",
] as const;

/**
 * What it takes to create an event: `POST /v1/events` carries `events:create`,
 * and `EventController` adds `members:view` at class level, which
 * `PermissionsGuard` requires alongside it (AND, not override). Offering a
 * create control on `events:create` alone hands a custom role a form whose
 * every save is refused.
 *
 * **The one spelling.** Code that reads it: mobile's `useCanCreateEvents`
 * (`new-event-sheet.tsx`) and quick actions (`quick-actions.ts`), the setup
 * checklist's event step (`packages/hooks/src/setup-checklist.ts`), web's
 * Events page create controls, and the chat + menu's Event row and `/event`
 * form on both surfaces (`PLUS_MENU_PERMISSIONS` in `@repo/chat-core/plus-menu`).
 */
export const EVENT_CREATE_PERMISSIONS = [
  "events:create",
  "members:view",
] as const;

/**
 * The ids, live and custom, whose holder can open chat, the roster and events
 * (#3670): a live role whose permissions grant `members:view` (so `*` counts),
 * or a custom role whose capabilities carry `members:view` itself, since the
 * server's `PermissionsGuard` drops `*` from custom roles. The seeded flag
 * doesn't count on its own, because a seeded role's permissions are editable.
 * Live and custom ids are both uuids, so one set holds them without
 * collisions. Web's member sheet calls it with live and custom roles; mobile's
 * roles sheet calls it per live role (`parseRoleOptions`), since it edits no
 * custom roles. `transfer_presidency` applies the same rule in SQL.
 */
export function memberAccessRoleIds(
  roles: readonly {
    id: string;
    permissions?: readonly string[] | null;
  }[],
  customRoles: readonly {
    id: string;
    capabilities?: readonly string[] | null;
  }[] = [],
): Set<string> {
  const ids = new Set<string>();
  for (const role of roles) {
    if (can("members:view", role.permissions)) ids.add(role.id);
  }
  for (const role of customRoles) {
    if (role.capabilities?.includes("members:view")) ids.add(role.id);
  }
  return ids;
}

/**
 * True when a role change is the one that takes away member access: some id
 * in `before` grants it and none in `after` does. A member who already lacked
 * it is not warned again on every save.
 */
export function removesMemberAccess(
  before: readonly string[],
  after: readonly string[],
  accessIds: ReadonlySet<string>,
): boolean {
  const grants = (ids: readonly string[]) => ids.some((id) => accessIds.has(id));
  return grants(before) && !grants(after);
}

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
 * **The one spelling of that union**, shared because three places have to agree
 * on it and a copy in each is how they drift:
 *
 * - the API routes — `ChatReportController`'s class-level `members:view` plus
 *   the handler-level `channels:manage` on the three officer routes, which
 *   `PermissionsGuard` ANDs. `chat-report.controller.spec.ts` pins that the
 *   decorators' union equals this list;
 * - who the API pages about a new report (`REPORT_QUEUE_PERMISSIONS` in
 *   `chat-report.service.ts` is this constant), so nobody is told about a queue
 *   that answers them 403;
 * - the web queue's `<Can allOf>` gate (`chat-reports-card.tsx`), so an officer
 *   holding one half is shown why rather than a Retry that can only ever 403.
 *
 * The prose restatements — the card's permission-denied copy
 * (`chat-report-copy.ts`, pinned against this list by its spec), `writing.md`
 * §7's Chat Admin row, and `spec/behavior/chat/README.md` § Report — are words,
 * and change with it by hand.
 */
export const CHAT_REPORT_QUEUE_PERMISSIONS = [
  "members:view",
  "channels:manage",
] as const;

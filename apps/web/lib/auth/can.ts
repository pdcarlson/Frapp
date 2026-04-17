/**
 * Permission gate utilities for the web dashboard.
 *
 * The API is the source of truth for RBAC; these helpers only answer "does
 * the caller's already-flattened permission set include the permission string
 * this component needs?". Mirror the wildcard rule from the server
 * `PermissionsGuard` so the two layers never drift.
 *
 * Typical usage:
 *
 * ```tsx
 * const { data } = useMyPermissions();
 * const perms = data?.permissions;
 * if (can("members:invite", perms)) { … }
 * ```
 *
 * For render-time gating prefer the `<Can>` component exported from
 * `components/shared/can.tsx` — it handles the loading case sensibly.
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
 * Does `permissions` grant **any** of the listed `required` permissions?
 * Empty `required` returns `false` (matches the server guard's OR-logic
 * semantics — nothing required means nothing granted). Use `canAll` with an
 * empty array if you want the "no gate" behavior.
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

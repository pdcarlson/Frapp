"use client";

import { useMemo, useState } from "react";

/** Something whose permissions are edited as a whole list: a role or a tier. */
export type PermissionHolder = {
  id: string;
  name: string;
  permissions: readonly string[];
};

/**
 * Switch one permission on or off for a role or a tier, saved on click. Web's
 * Roles pages and module "Who can" lists, and the phone's Roles screens
 * (#4074), all write through this, so every surface writes the same way.
 *
 * **An optimistic overlay, and it is a correctness device, not polish.**
 * `toggle` builds the next permission array from the holder it was rendered
 * with. The role and tier mutations' `onSuccess` fires `invalidateQueries`
 * without returning it, so `save` resolves *before* the refetched list
 * arrives, and two flips on the same holder in quick succession would both
 * start from the original array: the second would silently drop the first.
 * So each flip records what it sent, later flips read through it, and the
 * entry is dropped once the server's own copy agrees. A failed flip drops its
 * entry at once, so the control snaps back to the truth rather than showing a
 * grant that never landed, and `onError` says so in the app's own words.
 */
export function usePermissionOverlay(
  holders: readonly PermissionHolder[],
  save: (holder: PermissionHolder, next: string[]) => Promise<unknown>,
  onError: (
    holder: PermissionHolder,
    error: unknown,
    permission: string,
  ) => void,
) {
  const [overlay, setOverlay] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState<{
    id: string;
    permission: string;
  } | null>(null);

  /*
   * Reconciled during render rather than in an effect. An entry whose sent
   * array now matches the server's is indistinguishable from no entry at all,
   * so dropping it is a pure derivation, and no render can let a stale entry
   * mask a change another officer made to the same holder.
   */
  const liveOverlay = useMemo(() => {
    if (Object.keys(overlay).length === 0) return overlay;
    const next: Record<string, string[]> = {};
    for (const holder of holders) {
      const sent = overlay[holder.id];
      if (sent && !sameMembers(sent, holder.permissions)) {
        next[holder.id] = sent;
      }
    }
    return next;
  }, [overlay, holders]);

  const permissionsOf = (holder: PermissionHolder): readonly string[] =>
    liveOverlay[holder.id] ?? holder.permissions;

  async function toggle(
    holder: PermissionHolder,
    permission: string,
    held: boolean,
  ) {
    const current = permissionsOf(holder);
    const next = held
      ? current.filter((p) => p !== permission)
      : [...current, permission];

    setOverlay((prev) => ({ ...prev, [holder.id]: next }));
    setPending({ id: holder.id, permission });
    try {
      await save(holder, next);
    } catch (error) {
      setOverlay((prev) => {
        const reverted = { ...prev };
        delete reverted[holder.id];
        return reverted;
      });
      onError(holder, error, permission);
    } finally {
      setPending(null);
    }
  }

  return { permissionsOf, toggle, pending };
}

/** One row's override on a role in a tier: on, off, or `null` for "the tier decides". */
export type Override = boolean | null;

/**
 * One role's overrides (#4072), one key per save, shown at once. Each pick
 * saves on its own, as one key of `permission_overrides`
 * (`PATCH /v1/roles/:id`), so two quick picks on different rows never
 * overwrite each other the way two whole-list writes could.
 *
 * An overlay keeps a pick on screen from the tap until the server's copy
 * agrees (`save` resolves before the refetched role arrives, as above), and
 * a failed pick drops it so the row snaps back to the truth.
 */
export function useOverrideOverlay(
  role: { id: string; permission_overrides: Record<string, boolean> },
  save: (permission: string, value: Override) => Promise<unknown>,
  onError: (error: unknown, permission: string) => void,
) {
  const [overlay, setOverlay] = useState<Record<string, Override>>({});
  const [pending, setPending] = useState<string | null>(null);

  const stored = (permission: string): Override =>
    role.permission_overrides[permission] ?? null;

  // Reconciled during render: an entry the server now agrees with is the
  // same as no entry, so dropping it is a pure derivation.
  const liveOverlay = useMemo(() => {
    const next: Record<string, Override> = {};
    for (const [permission, value] of Object.entries(overlay)) {
      if ((role.permission_overrides[permission] ?? null) !== value) {
        next[permission] = value;
      }
    }
    return next;
  }, [overlay, role.permission_overrides]);

  const overrideOf = (permission: string): Override =>
    permission in liveOverlay ? liveOverlay[permission]! : stored(permission);

  async function set(permission: string, value: Override) {
    setOverlay((prev) => ({ ...prev, [permission]: value }));
    setPending(permission);
    try {
      await save(permission, value);
    } catch (error) {
      setOverlay((prev) => {
        const reverted = { ...prev };
        delete reverted[permission];
        return reverted;
      });
      onError(error, permission);
    } finally {
      setPending(null);
    }
  }

  return { overrideOf, set, pending };
}

/** Order-insensitive membership equality, for reconciling the overlay. */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((value) => set.has(value));
}

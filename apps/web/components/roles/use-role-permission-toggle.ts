"use client";

import { useMemo, useState } from "react";
import { useUpdateRole, useUpdateRoleTier } from "@repo/hooks";
import { getErrorMessage } from "@/lib/utils";
import { useToast } from "@/lib/hooks/use-toast";

type Holder = {
  id: string;
  name: string;
  permissions: readonly string[];
};

/**
 * Switch one permission on or off for a role or a tier, saved on click.
 *
 * Shared by the tier and role permission pages and a module page's "Who can"
 * list (#4073), the places a permission is edited, so all write the same way.
 *
 * **An optimistic overlay, and it is a correctness device, not polish.**
 * `toggle` builds the next permission array from the holder it was rendered
 * with. The mutations' `onSuccess` fires `invalidateQueries` without
 * returning it, so `mutateAsync` resolves *before* the refetched list
 * arrives, and two flips on the same holder in quick succession would both
 * start from the original array: the second would silently drop the first.
 * So each flip records what it sent, later flips read through it, and the
 * entry is dropped once the server's own copy agrees. A failed flip drops its
 * entry at once, so the control snaps back to the truth rather than showing a
 * grant that never landed.
 */
function usePermissionToggle(
  holders: readonly Holder[],
  save: (holder: Holder, next: string[]) => Promise<unknown>,
) {
  const { toast } = useToast();
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

  const permissionsOf = (holder: Holder): readonly string[] =>
    liveOverlay[holder.id] ?? holder.permissions;

  async function toggle(holder: Holder, permission: string, held: boolean) {
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
      toast({
        title: `Couldn't update ${holder.name}`,
        description: getErrorMessage(
          error,
          "The permission was not changed. Try again in a moment.",
        ),
        variant: "destructive",
      });
    } finally {
      setPending(null);
    }
  }

  return { permissionsOf, toggle, pending };
}

/** One role's permissions, as a whole list (`PATCH /v1/roles/:id`). */
export function useRolePermissionToggle(roles: readonly Holder[]) {
  const updateRole = useUpdateRole();
  return usePermissionToggle(roles, (role, next) =>
    updateRole.mutateAsync({ id: role.id, body: { permissions: next } }),
  );
}

/**
 * One tier's permissions (`PATCH /v1/role-tiers/:id`): the API rewrites every
 * role in the tier, each with its own overrides kept.
 */
export function useTierPermissionToggle(tiers: readonly Holder[]) {
  const updateTier = useUpdateRoleTier();
  return usePermissionToggle(tiers, (tier, next) =>
    updateTier.mutateAsync({ id: tier.id, body: { permissions: next } }),
  );
}

/** Order-insensitive membership equality, for reconciling the overlay. */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((value) => set.has(value));
}

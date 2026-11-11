"use client";

import { useMemo, useState } from "react";
import { useUpdateRole } from "@repo/hooks";
import { getErrorMessage } from "@/lib/utils";
import { useToast } from "@/lib/hooks/use-toast";

type ToggleRole = {
  id: string;
  name: string;
  permissions: readonly string[];
};

/**
 * Grant or take one permission from one role, saved on click.
 *
 * Shared by the Roles matrix and a module page's "Who can" list (#4073), the
 * two places a permission is edited, so both write the same way.
 *
 * **An optimistic overlay, and it is a correctness device, not polish.**
 * `toggle` builds the next permission array from the role it was rendered
 * with. `useUpdateRole`'s `onSuccess` fires `invalidateQueries` without
 * returning it, so `mutateAsync` resolves *before* the refetched roles arrive,
 * and two flips on the same role in quick succession would both start from
 * the original array: the second would silently drop the first. So each flip
 * records what it sent, later flips read through it, and the entry is dropped
 * once the server's own copy agrees. A failed flip drops its entry at once, so
 * the control snaps back to the truth rather than showing a grant that never
 * landed.
 */
export function useRolePermissionToggle(roles: readonly ToggleRole[]) {
  const { toast } = useToast();
  const updateRole = useUpdateRole();
  const [overlay, setOverlay] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState<{
    roleId: string;
    permission: string;
  } | null>(null);

  /*
   * Reconciled during render rather than in an effect. An entry whose sent
   * array now matches the server's is indistinguishable from no entry at all,
   * so dropping it is a pure derivation, and no render can let a stale entry
   * mask a change another officer made to the same role.
   */
  const liveOverlay = useMemo(() => {
    if (Object.keys(overlay).length === 0) return overlay;
    const next: Record<string, string[]> = {};
    for (const role of roles) {
      const sent = overlay[role.id];
      if (sent && !sameMembers(sent, role.permissions)) next[role.id] = sent;
    }
    return next;
  }, [overlay, roles]);

  const permissionsOf = (role: ToggleRole): readonly string[] =>
    liveOverlay[role.id] ?? role.permissions;

  async function toggle(role: ToggleRole, permission: string, held: boolean) {
    const current = permissionsOf(role);
    const next = held
      ? current.filter((p) => p !== permission)
      : [...current, permission];

    setOverlay((prev) => ({ ...prev, [role.id]: next }));
    setPending({ roleId: role.id, permission });
    try {
      await updateRole.mutateAsync({
        id: role.id,
        body: { permissions: next },
      });
    } catch (error) {
      setOverlay((prev) => {
        const reverted = { ...prev };
        delete reverted[role.id];
        return reverted;
      });
      toast({
        title: `Couldn't update ${role.name}`,
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

/** Order-insensitive membership equality, for reconciling the overlay. */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((value) => set.has(value));
}

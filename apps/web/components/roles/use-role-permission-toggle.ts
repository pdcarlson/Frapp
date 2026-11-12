"use client";

import { useUpdateRole, useUpdateRoleTier } from "@repo/hooks";
import {
  usePermissionOverlay,
  type PermissionHolder,
} from "@repo/hooks/permission-overlay";
import { getErrorMessage } from "@/lib/utils";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Switch one permission on or off for a role or a tier, saved on click.
 *
 * Shared by the tier and role permission pages and a module page's "Who can"
 * list (#4073), the places a permission is edited, so all write the same way.
 * The optimistic overlay that keeps two quick flips from overwriting each
 * other lives in `@repo/hooks/permission-overlay`, shared with the phone.
 */
function useFailureToast() {
  const { toast } = useToast();
  return (holder: PermissionHolder, error: unknown) =>
    toast({
      title: `Couldn't update ${holder.name}`,
      description: getErrorMessage(
        error,
        "The permission was not changed. Try again in a moment.",
      ),
      variant: "destructive",
    });
}

/** One role's permissions, as a whole list (`PATCH /v1/roles/:id`). */
export function useRolePermissionToggle(roles: readonly PermissionHolder[]) {
  const updateRole = useUpdateRole();
  const onError = useFailureToast();
  return usePermissionOverlay(
    roles,
    (role, next) =>
      updateRole.mutateAsync({ id: role.id, body: { permissions: next } }),
    onError,
  );
}

/**
 * One tier's permissions (`PATCH /v1/role-tiers/:id`): the API rewrites every
 * role in the tier, each with its own overrides kept.
 */
export function useTierPermissionToggle(tiers: readonly PermissionHolder[]) {
  const updateTier = useUpdateRoleTier();
  const onError = useFailureToast();
  return usePermissionOverlay(
    tiers,
    (tier, next) =>
      updateTier.mutateAsync({ id: tier.id, body: { permissions: next } }),
    onError,
  );
}

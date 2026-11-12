"use client";

import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/async-states";
import { SettingsListCardSkeleton } from "@/components/settings/settings-skeleton";
import { PermissionSwitchList } from "@/components/roles/permission-switch-list";
import { useTierPermissionToggle } from "@/components/roles/use-role-permission-toggle";
import { useRolesData } from "@/components/roles/use-roles-data";
import { byDisplayOrder, mayGrant, reachesTier } from "@repo/hooks/role-tiers";

/**
 * A tier's permissions (#3990): "open a tier, choose edit permissions, and
 * toggle what that tier can do". One page with room for every module's
 * switches, saved on click. A switch here changes every role in the tier at
 * once; a role that was set apart from its tier on its own page keeps that
 * difference (the API rewrites each role "with its own overrides applied").
 */
export function TierPermissionsPage({
  tierId,
  onBack,
  onOpenRole,
}: {
  tierId: string;
  onBack: () => void;
  onOpenRole: (roleId: string) => void;
}) {
  const { rolesQuery, tiersQuery, roles, tiers, reach, canManage, words } =
    useRolesData();
  const tier = tiers.find((candidate) => candidate.id === tierId) ?? null;
  const holders = useMemo(() => (tier ? [tier] : []), [tier]);
  const { permissionsOf, toggle, pending } = useTierPermissionToggle(holders);
  const tierRoles = useMemo(
    () => roles.filter((role) => role.tier_id === tierId).sort(byDisplayOrder),
    [roles, tierId],
  );

  const back = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onBack}
      className="-ml-3"
    >
      <ChevronLeft aria-hidden />
      Roles
    </Button>
  );

  if (tiersQuery.isPending || rolesQuery.isPending) {
    return (
      <div className="space-y-4">
        {back}
        <SettingsListCardSkeleton label="Loading permissions" rows={6} />
      </div>
    );
  }
  if (tiersQuery.isError || !tier) {
    return (
      <div className="space-y-4">
        {back}
        <ErrorState
          title={
            tiersQuery.isError
              ? `Couldn't load this ${words.singular}`
              : `This ${words.singular} is gone`
          }
          description={
            tiersQuery.isError
              ? "Retry, or go back to Roles."
              : `Someone may have deleted it. Go back to Roles to see the ${words.plural} as they are now.`
          }
          onRetry={
            tiersQuery.isError ? () => void tiersQuery.refetch() : undefined
          }
        />
      </div>
    );
  }

  const held = permissionsOf(tier);
  const editable = canManage && reachesTier(reach, tier);
  const lockedReason = !canManage
    ? "Your role can't change permissions."
    : !reach.known
      ? "Checking what your role can change."
      : !editable
        ? `This ${words.singular} ranks at or above yours, so your role can't change it.`
        : null;

  return (
    <div className="space-y-8">
      <header className="space-y-3 border-b border-border pb-6">
        {back}
        <div className="space-y-1">
          <h2 className="text-title text-foreground">{tier.name}</h2>
          <p className="text-sm text-muted-foreground">
            What every role in this {words.singular} can do. Changes save as you
            make them. A role can be set apart from its {words.singular} on its
            own page.
          </p>
        </div>
        {tierRoles.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground">
            <span>Roles in it:</span>
            {tierRoles.map((role, index) => (
              <span key={role.id}>
                <button
                  type="button"
                  onClick={() => onOpenRole(role.id)}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {role.name}
                </button>
                {index < tierRoles.length - 1 ? "," : ""}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-caption text-muted-foreground">
            No roles in this {words.singular} yet.
          </p>
        )}
      </header>

      <PermissionSwitchList
        idPrefix={`tier-${tier.id}`}
        holderName={tier.name}
        isOn={(permission) => held.includes(permission)}
        onToggle={(permission, on) => void toggle(tier, permission, on)}
        extraPermissions={held}
        lockedReason={lockedReason}
        rowLockedReason={(permission, on) =>
          !on && !mayGrant(reach, permission)
            ? "You can't give this, because your role doesn't have it."
            : null
        }
        pendingPermission={pending?.id === tier.id ? pending.permission : null}
      />
    </div>
  );
}

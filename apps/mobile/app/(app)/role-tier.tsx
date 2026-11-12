import { useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useUpdateRoleTier } from "@repo/hooks";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { usePermissionOverlay } from "@repo/hooks/permission-overlay";
import {
  byDisplayOrder,
  mayGrant,
  reachesTier,
} from "@repo/hooks/role-tiers";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_ROLES } from "@/components/back-row";
import {
  ListRow,
  ListRowSkeleton,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import { PermissionToggleList } from "@/components/roles/permission-toggle-list";
import { describeError } from "@/lib/roles/save-error";
import {
  CANT_GIVE,
  lockedReasonFor,
  useRolesData,
} from "@/lib/roles/use-roles-data";
import { useFrappTheme } from "@/lib/theme";

/**
 * A tier's permissions on the phone (#4074), web's tier page (#3990): one
 * switch per permission, grouped by module, saved on tap. A switch here
 * changes every role in the tier at once; a role set apart from its tier on
 * its own screen keeps that difference (the API rewrites each role "with its
 * own overrides applied"). The roles in the tier are listed under the
 * switches, each a tap from its own screen.
 *
 * The rank rules are web's (`@repo/hooks/role-tiers`): a tier at or above
 * the officer's own is read-only and says so once at the top, and a
 * permission their role lacks can't be switched on and says why on its row.
 */
export default function RoleTierScreen() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const params = useLocalSearchParams<{ tierId?: string | string[] }>();
  const tierId = Array.isArray(params.tierId)
    ? params.tierId[0]
    : (params.tierId ?? "");
  const data = useRolesData();
  const { rolesQuery, tiersQuery, roles, tiers, reach, canManage, words } =
    data;
  const tier = tiers.find((candidate) => candidate.id === tierId) ?? null;
  const holders = useMemo(() => (tier ? [tier] : []), [tier]);
  const updateTier = useUpdateRoleTier();
  const [failure, setFailure] = useState<{
    permission: string;
    message: string;
  } | null>(null);
  const { permissionsOf, toggle, pending } = usePermissionOverlay(
    holders,
    (holder, next) =>
      updateTier.mutateAsync({ id: holder.id, body: { permissions: next } }),
    (holder, error, permission) =>
      setFailure({ permission, message: describeError(holder.name, error) }),
  );
  const tierRoles = useMemo(
    () => roles.filter((role) => role.tier_id === tierId).sort(byDisplayOrder),
    [roles, tierId],
  );

  if (tiersQuery.isError || rolesQuery.isError) {
    return (
      <ScreenShell back={BACK_TO_ROLES} title={words.Singular}>
        <ErrorState
          title={`Couldn't load this ${words.singular}`}
          body={describeLoadFailure(tiersQuery.error ?? rolesQuery.error)}
          onRetry={() => {
            void tiersQuery.refetch();
            void rolesQuery.refetch();
          }}
          isRetrying={tiersQuery.isFetching || rolesQuery.isFetching}
        />
      </ScreenShell>
    );
  }
  if (!tiersQuery.isSuccess || !rolesQuery.isSuccess) {
    return (
      <ScreenShell back={BACK_TO_ROLES} title={words.Singular}>
        <SkeletonRegion label="Loading permissions" style={styles.skeleton}>
          <ListSection>
            {[0, 1, 2, 3, 4].map((index) => (
              <ListRowSkeleton key={index} index={index} />
            ))}
          </ListSection>
        </SkeletonRegion>
      </ScreenShell>
    );
  }
  if (!tier) {
    return (
      <ScreenShell back={BACK_TO_ROLES} title={words.Singular}>
        <ErrorState
          title={`This ${words.singular} is gone`}
          body={`Someone may have deleted it. Go back to Roles to see the ${words.plural} as they are now.`}
        />
      </ScreenShell>
    );
  }

  const held = permissionsOf(tier);
  const lockedReason = lockedReasonFor(
    data,
    canManage && reachesTier(reach, tier),
    words.singular,
  );

  return (
    <ScreenShell
      back={BACK_TO_ROLES}
      title={tier.name}
      subtitle={`What every role in this ${words.singular} can do. A role can be set apart on its own page.`}
    >
      <PermissionToggleList
        holderName={tier.name}
        isOn={(permission) => held.includes(permission)}
        onToggle={(permission, on) => {
          setFailure(null);
          void toggle(tier, permission, on);
        }}
        failure={failure}
        extraPermissions={held}
        lockedReason={lockedReason}
        rowLockedReason={(permission, on) =>
          !on && !mayGrant(reach, permission) ? CANT_GIVE : null
        }
        pendingPermission={pending?.id === tier.id ? pending.permission : null}
      />

      <SectionHeader count={tierRoles.length}>
        {`Roles in ${tier.name}`}
      </SectionHeader>
      <ListSection>
        {tierRoles.length === 0 ? (
          <ListRow
            label={`No roles in this ${words.singular} yet`}
            variant="detail"
          />
        ) : (
          tierRoles.map((role) => (
            <ListRow
              key={role.id}
              label={role.name}
              accessibilityHint="Opens what this role can do."
              onPress={() =>
                router.push({ pathname: "/role", params: { roleId: role.id } })
              }
            />
          ))
        )}
      </ListSection>
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    skeleton: { gap: tokens.spacing.lg },
  });
}

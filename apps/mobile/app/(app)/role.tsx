import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useIsPermissionHidden, useUpdateRole } from "@repo/hooks";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import {
  useOverrideOverlay,
  usePermissionOverlay,
} from "@repo/hooks/permission-overlay";
import {
  isWildcardRole,
  mayGrant,
  permissionRows,
  reachesRole,
  type TieredRole,
  type TierRow,
} from "@repo/hooks/role-tiers";
import { groupPermissionsByModule } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_ROLES } from "@/components/back-row";
import {
  ListRow,
  ListRowSkeleton,
  ListSection,
} from "@/components/list-section";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import {
  PermissionGroup,
  PermissionToggleList,
} from "@/components/roles/permission-toggle-list";
import {
  OverrideSheet,
  type OverrideTarget,
} from "@/components/roles/override-sheet";
import { describeError } from "@/lib/roles/save-error";
import {
  CANT_GIVE,
  lockedReasonFor,
  useRolesData,
  type RolesData,
} from "@/lib/roles/use-roles-data";
import { typeRole, useFrappTheme } from "@/lib/theme";

type Failure = { permission: string; message: string } | null;

/**
 * One role on the phone (#4074), web's role page (#3990, #4072) for what it
 * can do. Its tier and how many hold it lead; then its permissions.
 *
 * - **In a tier**, each permission row shows what the role ends up with (On
 *   or Off), and a row set apart from the tier says so on its second line
 *   ("Set for this role. Officers has it off."). A tap opens the three answers web gives, Same as tier, On, and Off
 *   (`components/roles/override-sheet.tsx`). Same as tier keeps following the
 *   tier when the tier changes; On or Off keeps the role's own answer.
 * - **Outside the tiers**, there is no tier to follow, so each permission is
 *   a plain switch, as on a tier's page.
 * - **The President's role** (`*`) can do everything and shows every switch
 *   on and still; it moves only through Transfer presidency, on web.
 *
 * Name, color, @mention and moving a role between tiers stay on web with
 * the rest of a role's setup; giving a member a role is the Directory's
 * member sheet, as it has been (#3676).
 */
export default function RoleScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const params = useLocalSearchParams<{ roleId?: string | string[] }>();
  const roleId = Array.isArray(params.roleId)
    ? params.roleId[0]
    : (params.roleId ?? "");
  const data = useRolesData();
  const { rolesQuery, tiersQuery, roles, words } = data;
  const role = roles.find((candidate) => candidate.id === roleId) ?? null;

  if (rolesQuery.isError || tiersQuery.isError) {
    return (
      <ScreenShell back={BACK_TO_ROLES} title="Role">
        <ErrorState
          title="Couldn't load this role"
          body={describeLoadFailure(rolesQuery.error ?? tiersQuery.error)}
          onRetry={() => {
            void rolesQuery.refetch();
            void tiersQuery.refetch();
          }}
          isRetrying={rolesQuery.isFetching || tiersQuery.isFetching}
        />
      </ScreenShell>
    );
  }
  if (!rolesQuery.isSuccess || !tiersQuery.isSuccess) {
    return (
      <ScreenShell back={BACK_TO_ROLES} title="Role">
        <SkeletonRegion label="Loading role" style={styles.skeleton}>
          <ListSection>
            {[0, 1, 2, 3, 4].map((index) => (
              <ListRowSkeleton key={index} index={index} />
            ))}
          </ListSection>
        </SkeletonRegion>
      </ScreenShell>
    );
  }
  if (!role) {
    return (
      <ScreenShell back={BACK_TO_ROLES} title="Role">
        <ErrorState
          title="This role is gone"
          body={`Someone may have deleted it. Go back to Roles to see the ${words.plural} as they are now.`}
        />
      </ScreenShell>
    );
  }
  // Keyed by role so a failure line never carries over to another role.
  return <RoleBody key={role.id} role={role} data={data} />;
}

function RoleBody({ role, data }: { role: TieredRole; data: RolesData }) {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { tiers, reach, canManage, words, memberCounts } = data;
  const tier = tiers.find((candidate) => candidate.id === role.tier_id) ?? null;
  const wildcard = isWildcardRole(role);
  const count = memberCounts?.get(role.id) ?? (memberCounts ? 0 : null);
  const lockedReason = wildcard
    ? "This role can do everything. That only moves through Transfer presidency."
    : lockedReasonFor(
        data,
        canManage && reachesRole(reach, role, tiers),
        "role",
      );

  return (
    <ScreenShell back={BACK_TO_ROLES} title={role.name}>
      <ListSection>
        {tier ? (
          <ListRow
            label={words.Singular}
            value={tier.name}
            accessibilityHint={`Opens what every role in ${tier.name} can do.`}
            onPress={() =>
              router.push({
                pathname: "/role-tier",
                params: { tierId: tier.id },
              })
            }
          />
        ) : (
          <ListRow
            label={words.Singular}
            value={`Outside the ${words.plural}`}
            variant="detail"
          />
        )}
        <ListRow
          label="Members"
          value={count === null ? "—" : String(count)}
          variant="detail"
        />
      </ListSection>

      {wildcard ? null : (
        <Text style={styles.hint}>
          {tier
            ? `Starts from ${tier.name}. Rows set apart from it say so; tap one to change it.`
            : `Outside the ${words.plural}, so its permissions are its own.`}
        </Text>
      )}

      {tier && !wildcard ? (
        <OverrideList
          role={role}
          tier={tier}
          tierWord={words.singular}
          lockedReason={lockedReason}
          mayGrant={(permission) => mayGrant(reach, permission)}
        />
      ) : (
        <OwnPermissions
          role={role}
          wildcard={wildcard}
          lockedReason={lockedReason}
          mayGrant={(permission) => mayGrant(reach, permission)}
        />
      )}
    </ScreenShell>
  );
}

/** A role outside the tiers, or the President's: one switch per permission. */
function OwnPermissions({
  role,
  wildcard,
  lockedReason,
  mayGrant: canGive,
}: {
  role: TieredRole;
  wildcard: boolean;
  lockedReason: string | null;
  mayGrant: (permission: string) => boolean;
}) {
  const updateRole = useUpdateRole();
  const holders = useMemo(() => [role], [role]);
  const [failure, setFailure] = useState<Failure>(null);
  const { permissionsOf, toggle, pending } = usePermissionOverlay(
    holders,
    (holder, next) =>
      updateRole.mutateAsync({ id: holder.id, body: { permissions: next } }),
    (holder, error, permission) =>
      setFailure({ permission, message: describeError(holder.name, error) }),
  );
  const held = permissionsOf(role);

  return (
    <PermissionToggleList
      holderName={role.name}
      isOn={(permission) => wildcard || held.includes(permission)}
      onToggle={(permission, on) => {
        setFailure(null);
        void toggle(role, permission, on);
      }}
      extraPermissions={wildcard ? [] : held}
      lockedReason={lockedReason}
      rowLockedReason={(permission, on) =>
        !on && !canGive(permission) ? CANT_GIVE : null
      }
      pendingPermission={pending?.id === role.id ? pending.permission : null}
      failure={failure}
    />
  );
}

/**
 * A role in a tier: each permission's answer, and where it comes from, with
 * the three-way pick a tap away. Each pick saves on its own, as one key of
 * `permission_overrides`, through the overlay web's list uses.
 */
function OverrideList({
  role,
  tier,
  tierWord,
  lockedReason,
  mayGrant: canGive,
}: {
  role: TieredRole;
  tier: TierRow;
  tierWord: string;
  lockedReason: string | null;
  mayGrant: (permission: string) => boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const updateRole = useUpdateRole();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [target, setTarget] = useState<OverrideTarget | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const { overrideOf, set, pending } = useOverrideOverlay(
    role,
    (permission, value) =>
      updateRole.mutateAsync({
        id: role.id,
        body: { permission_overrides: { [permission]: value } },
      }),
    (error, permission) =>
      setFailure({ permission, message: describeError(role.name, error) }),
  );
  const isHidden = useIsPermissionHidden();
  const groups = useMemo(
    () =>
      groupPermissionsByModule(
        permissionRows(
          [
            ...tier.permissions,
            ...role.permissions,
            ...Object.keys(role.permission_overrides),
          ],
          isHidden,
        ),
      ),
    [tier.permissions, role.permissions, role.permission_overrides, isHidden],
  );

  return (
    <>
      {lockedReason ? <Text style={styles.hint}>{lockedReason}</Text> : null}
      {groups.map((group) => (
        <PermissionGroup key={group.label} label={group.label}>
          {group.entries.map((row) => {
            const tierHas = tier.permissions.includes(row.permission);
            const override = overrideOf(row.permission);
            const holds = override ?? tierHas;
            const stored = role.permission_overrides[row.permission];
            const allowed = canGive(row.permission);
            // What the API refuses (#4071): an override switched on, or any
            // pick that leaves the role holding something new, needs the
            // caller to hold it. Off is always allowed.
            const onRefused = !allowed && stored !== true;
            const tierRefused = !allowed && tierHas && !holds;
            const failed =
              failure?.permission === row.permission ? failure.message : null;
            // Only a row set apart says so. Following the tier is the
            // default every row starts on, and "Same as <tier>" under all
            // forty rows was a wall that hid the few that differ; the line
            // above the list says where they start from.
            const source =
              override === null
                ? null
                : `Set for this role. ${tier.name} has it ${tierHas ? "on" : "off"}.`;
            const locked =
              Boolean(lockedReason) || pending === row.permission;
            return (
              <ListRow
                key={row.permission}
                label={row.label}
                value={holds ? "On" : "Off"}
                description={failed ?? source}
                descriptionTone={failed ? "destructive" : "default"}
                accessibilityHint={
                  locked ? undefined : "Choose same as tier, on, or off."
                }
                onPress={
                  locked
                    ? undefined
                    : () => {
                        setTarget({
                          permission: row.permission,
                          label: row.label,
                          roleName: role.name,
                          tierName: tier.name,
                          tierWord,
                          tierHas,
                          current: override,
                          onRefused,
                          tierRefused,
                          refusedReason: CANT_GIVE,
                        });
                        sheetRef.current?.present();
                      }
                }
              />
            );
          })}
        </PermissionGroup>
      ))}
      <OverrideSheet
        ref={sheetRef}
        target={target}
        onPick={(permission, value) => {
          setFailure(null);
          void set(permission, value);
        }}
      />
    </>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    skeleton: { gap: tokens.spacing.lg },
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}

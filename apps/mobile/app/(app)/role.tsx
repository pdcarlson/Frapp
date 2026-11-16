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
import {
  groupPermissionsByModule,
  SELF_ASSIGNABLE_REFUSAL_COPY,
  SELF_ASSIGNABLE_SWITCH_DESCRIPTION,
  SELF_ASSIGNABLE_TIERED_CODE,
  selfAssignableRefusal,
  type SelfAssignableRefusal,
} from "@repo/validation";
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
import { Toggle } from "@/components/toggle";
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
 * - **Non-chapter business** (#4958): on a role without a `system_key`, the
 *   switch that lets members add and remove it themselves, as web's role
 *   page has. It saves at once, like every switch on this screen, and is
 *   disabled with the rule's words on a role that can't be marked.
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

  if ((rolesQuery.isError && rolesQuery.data === undefined) || (tiersQuery.isError && tiersQuery.data === undefined)) {
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

      {role.system_key ? null : (
        <PickableSwitch
          role={role}
          lockedReason={lockedReason}
          rolesUpdatedAt={data.rolesQuery.dataUpdatedAt}
        />
      )}

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

/**
 * Non-chapter business (#4958, Shawn 2026-11-14): whether members add and
 * remove this role themselves. Only a safe role can be marked
 * (`spec/behavior/rbac.md` § Self-assignable roles), so on one that isn't the
 * switch says why and only turns off. A marked role that became unsafe some
 * other way can still be unmarked.
 */
function PickableSwitch({
  role,
  lockedReason,
  rolesUpdatedAt,
}: {
  role: TieredRole;
  lockedReason: string | null;
  /** When the roles read last landed (`dataUpdatedAt`). */
  rolesUpdatedAt: number;
}) {
  const updateRole = useUpdateRole();
  // The value saved, shown until the roles read after the save lands, so the
  // switch doesn't flick back between the save and the refetch. Dropped on
  // the first read after the save whatever it says, so a value another
  // officer wrote meanwhile shows rather than this one sticking.
  const [wanted, setWanted] = useState<boolean | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  if (
    wanted !== null &&
    savedAt !== null &&
    (rolesUpdatedAt > savedAt || wanted === role.self_assignable)
  ) {
    setWanted(null);
    setSavedAt(null);
  }
  const inFlight = wanted !== null && savedAt === null;
  const value = wanted ?? role.self_assignable;
  const refusal = selfAssignableRefusal(role);
  const description =
    failure ?? (refusal ? refusalOnPhone(refusal) : SELF_ASSIGNABLE_SWITCH_DESCRIPTION);

  async function save(next: boolean) {
    setWanted(next);
    setSavedAt(null);
    setFailure(null);
    try {
      await updateRole.mutateAsync({
        id: role.id,
        body: { self_assignable: next },
      });
      setSavedAt(Date.now());
    } catch (error) {
      setWanted(null);
      setFailure(
        describeError(
          role.name,
          error,
          "Non-chapter business was not changed. Try again in a moment.",
        ),
      );
    }
  }

  return (
    <ListSection>
      <ListRow
        label="Non-chapter business"
        description={description}
        descriptionTone={failure ? "destructive" : "default"}
        trailing={
          <Toggle
            value={value}
            disabled={
              Boolean(lockedReason) ||
              inFlight ||
              (refusal !== null && !value)
            }
            onValueChange={(next) => void save(next)}
            accessibilityLabel={`Non-chapter business for ${role.name}`}
          />
        }
      />
    </ListSection>
  );
}

/**
 * Why a role can't be marked, in the phone's words. Web's tiered refusal says
 * to move the role out of its tier, which the phone can't do (moving roles
 * stays on web), so the phone says where.
 */
function refusalOnPhone(refusal: SelfAssignableRefusal): string {
  return refusal === SELF_ASSIGNABLE_TIERED_CODE
    ? "Roles members pick themselves sit outside the tiers, since a tier carries rank. Move it out of its tier on the web dashboard first."
    : SELF_ASSIGNABLE_REFUSAL_COPY[refusal];
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

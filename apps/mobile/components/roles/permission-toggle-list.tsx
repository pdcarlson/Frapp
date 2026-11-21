import { useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { groupPermissionsByModule } from "@repo/validation";
import { permissionRows } from "@repo/hooks/role-tiers";
import { useIsPermissionHidden } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { Toggle } from "@/components/toggle";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * A tier's or a role's permissions on the phone (#4074): one grouped list per
 * module, in the registry's order and words, one switch per permission, saved
 * on tap. Web's `PermissionSwitchList` in the iOS Settings shape: a section
 * heading per module and a row per switch.
 *
 * Labels only. The registry's one-line descriptions are web's; on a phone
 * thirty-odd two-line rows pushed the list three screens long, and the labels
 * are verb-first ("Invite members", "Create channels"). A screen reader still
 * hears the description as the row's hint. A row's second line is kept for
 * what a switch can't show: why it can't change, or that its save failed.
 */
export function PermissionToggleList({
  holderName,
  isOn,
  onToggle,
  extraPermissions = [],
  lockedReason,
  rowLockedReason,
  pendingPermission,
  failure = null,
}: {
  /** Names the holder in each switch's accessible name. */
  holderName: string;
  isOn: (permission: string) => boolean;
  onToggle: (permission: string, currentlyOn: boolean) => void;
  /** Strings the holder carries that the registry does not list. */
  extraPermissions?: readonly string[];
  /** Set when nothing here can change, saying why, once at the top. */
  lockedReason: string | null;
  /** Why one row can't change, or null when it can. */
  rowLockedReason?: (permission: string, currentlyOn: boolean) => string | null;
  /** The permission whose save is in flight, if any. */
  pendingPermission: string | null;
  /** The last save that failed, said on its own row (the phone has no toast). */
  failure?: { permission: string; message: string } | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const isHidden = useIsPermissionHidden();
  const groups = useMemo(
    () => groupPermissionsByModule(permissionRows(extraPermissions, isHidden)),
    [extraPermissions, isHidden],
  );

  return (
    <>
      {lockedReason ? <Text style={styles.locked}>{lockedReason}</Text> : null}
      {groups.map((group) => (
        <PermissionGroup key={group.label} label={group.label}>
          {group.entries.map((row) => {
            const on = isOn(row.permission);
            const rowReason = lockedReason
              ? null
              : (rowLockedReason?.(row.permission, on) ?? null);
            const disabled =
              Boolean(lockedReason) ||
              rowReason !== null ||
              pendingPermission === row.permission;
            const failed =
              failure?.permission === row.permission ? failure.message : null;
            return (
              <ListRow
                key={row.permission}
                label={row.label}
                description={failed ?? rowReason}
                descriptionTone={failed ? "destructive" : "default"}
                accessibilityHint={row.description ?? undefined}
                trailing={
                  <Toggle
                    value={on}
                    disabled={disabled}
                    onValueChange={() => onToggle(row.permission, on)}
                    accessibilityLabel={`${row.label} for ${holderName}`}
                  />
                }
              />
            );
          })}
        </PermissionGroup>
      ))}
    </>
  );
}

/** One module's heading and its rows, shared with the role's override list. */
export function PermissionGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SectionHeader>{label}</SectionHeader>
      <ListSection>{children}</ListSection>
    </>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    locked: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}

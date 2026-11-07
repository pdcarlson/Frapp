import { forwardRef, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { useRoles } from "@repo/hooks";
import {
  EVENT_ATTENDANCE_LABELS,
  roleChoicesFor,
  rolesToAdd,
  statusForAddedRole,
  withEveryone,
  withRole,
  type EventAttendanceDraft,
  type EventAttendanceStatus,
} from "@repo/validation";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { Segmented } from "@/components/segmented";
import { CloseGlyph } from "@/components/control-glyphs";
import {
  roleOptionsFrom,
  type RoleOption,
} from "@/lib/events/attendance-roles";

/**
 * "Who's coming": an event's attendance by role (`spec/behavior/events.md`
 * § Attendance by role), stacked over the New event sheet.
 *
 * Three parts, top to bottom: the default for everyone, the roles that differ
 * from it (each with the answers it can switch between, and a remove), and a
 * search to add a role from. A chapter with a hundred roles sees the same
 * short screen as one with seven: only roles the officer has set are rows
 * with controls; the rest sit in the searchable list below.
 *
 * Controlled: the parent's draft holds the answer, so a close keeps it and
 * the New event sheet's summary row updates as it changes.
 */
export interface AttendanceSheetProps {
  value: EventAttendanceDraft;
  onChange: (next: EventAttendanceDraft) => void;
}

const EVERYONE_OPTIONS = (["required", "optional", "not_invited"] as const).map(
  (value) => ({ value, label: EVENT_ATTENDANCE_LABELS[value] }),
);

export const AttendanceSheet = forwardRef<
  BottomSheetModal,
  AttendanceSheetProps
>(function AttendanceSheet({ value, onChange }, ref) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const tall = useTallSheetProps();
  const close = useSheetClose(ref);
  const rolesQuery = useRoles();
  const [search, setSearch] = useState("");

  const options = useMemo(
    () => roleOptionsFrom(rolesQuery.data),
    [rolesQuery.data],
  );
  const nameOf = useMemo(() => {
    const byId = new Map(options.map((role) => [role.id, role.name]));
    return (id: string) => byId.get(id);
  }, [options]);
  const differing = Object.entries(value.roles);
  const addable = useMemo(
    () => rolesToAdd(options, value, search),
    [options, value, search],
  );
  const choices = roleChoicesFor(value.everyone).map((status) => ({
    value: status,
    label: EVENT_ATTENDANCE_LABELS[status],
  }));

  const header = (
    <View style={styles.header}>
      <TallSheetHeader title="Who's coming" onClose={close} />

      <Text style={styles.sectionLabel}>Everyone</Text>
      <Segmented
        options={EVERYONE_OPTIONS}
        value={value.everyone}
        onChange={(everyone) => onChange(withEveryone(value, everyone))}
        accessibilityLabel="Attendance for everyone"
      />
      <Text style={styles.caption}>
        {everyoneCaption(value.everyone, differing.length > 0)}
      </Text>

      {differing.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Roles that differ</Text>
          <View style={styles.group}>
            {differing.map(([roleId, status], index) => (
              <View
                key={roleId}
                style={[styles.roleRow, index > 0 ? styles.rowDivider : null]}
              >
                <Text style={styles.roleName} numberOfLines={1}>
                  {nameOf(roleId) ?? "Removed role"}
                </Text>
                <View style={styles.roleChoice}>
                  <Segmented
                    options={choices}
                    value={status}
                    onChange={(next: EventAttendanceStatus) =>
                      onChange(withRole(value, roleId, next))
                    }
                    accessibilityLabel={`Attendance for ${nameOf(roleId) ?? "this role"}`}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${nameOf(roleId) ?? "this role"}`}
                  hitSlop={10}
                  onPress={() => onChange(withRole(value, roleId, null))}
                  style={styles.remove}
                >
                  <CloseGlyph color={tokens.color.text.muted} size={14} />
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.sectionLabel}>Set a role differently</Text>
      <BottomSheetTextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search roles"
        placeholderTextColor={tokens.color.text.muted}
        accessibilityLabel="Search roles"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.field}
      />
    </View>
  );

  return (
    <BottomSheetModal
      ref={ref}
      {...tall}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => setSearch("")}
    >
      <SheetBackToClose onClose={close} />
      <BottomSheetFlatList
        onAccessibilityEscape={close}
        data={addable}
        keyExtractor={(role: RoleOption) => role.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={styles.caption}>
            {rolesQuery.isPending
              ? "Loading roles…"
              : rolesQuery.isError
                ? "Couldn't load your chapter's roles."
                : options.length === 0
                  ? "Your chapter has no roles yet."
                  : search.trim()
                    ? "No roles match that search."
                    : "Every role is set above."}
          </Text>
        }
        renderItem={({ item }: { item: RoleOption }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, set ${EVENT_ATTENDANCE_LABELS[statusForAddedRole(value.everyone)].toLowerCase()}`}
            onPress={() => {
              onChange(
                withRole(value, item.id, statusForAddedRole(value.everyone)),
              );
              setSearch("");
            }}
            style={styles.addRow}
          >
            <Text style={styles.roleName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.addHint}>
              {EVENT_ATTENDANCE_LABELS[statusForAddedRole(value.everyone)]}
            </Text>
          </Pressable>
        )}
      />
    </BottomSheetModal>
  );
});

function everyoneCaption(
  everyone: EventAttendanceStatus,
  hasRoles: boolean,
): string {
  switch (everyone) {
    case "required":
      return "Anyone who doesn't check in is marked absent. Alumni are left out unless you add their role.";
    case "optional":
      return "Everyone can see it and check in for points. Nobody is marked absent.";
    case "not_invited":
      return hasRoles
        ? "Only the roles below can see it."
        : "Add the roles this event is for.";
  }
}

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    content: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    header: {
      gap: tokens.spacing.sm,
      paddingBottom: tokens.spacing.sm,
    },
    sectionLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.sm,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    field: fieldStyles.field,
    group: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
    },
    roleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    roleName: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    roleChoice: {
      width: 190,
    },
    remove: {
      width: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    addRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    addHint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
  });
}

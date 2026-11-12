import { forwardRef, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { useRoles } from "@repo/hooks";
import {
  ALUMNI_FOLLOWING_NOTE,
  ATTENDANCE_SEARCH_FROM,
  EVENT_ATTENDANCE_LABELS,
  alumniRoleIdOf,
  attendanceChoices,
  attendanceOfRole,
  attendanceRows,
  describeAttendance,
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
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { Segmented } from "@/components/segmented";
import { roleOptionsFrom } from "@/lib/events/attendance-roles";

/**
 * "Who's coming": an event's attendance by role (`spec/behavior/events.md`
 * § Attendance by role), a step stacked over the New event sheet (#3706).
 *
 * One row per role, each with the same three answers, and "Everyone else"
 * first: the answer for anyone whose roles aren't set apart. A role that only
 * follows Everyone else holds its answer in neutral ink; a role set apart is
 * lit in the accent, so what was changed reads at a glance. One line at the
 * top says the whole rule in words. Comparable: Discord's channel permission
 * overrides, a row per role with the same three-way switch and @everyone
 * first.
 *
 * Done, a swipe down and Android back all close it onto the New event sheet,
 * which stays presented underneath (`SHEET_STACK_BEHAVIOR`), with the
 * summary row filled in. Nothing here can lose the event being made.
 *
 * Built for a chapter at real scale (an imported Discord server brings a
 * hundred roles): the list is virtualized, a search narrows it once there are
 * more than {@link ATTENDANCE_SEARCH_FROM} roles, and the roles set apart when the sheet
 * opened lead the list. The order is taken once per visit, so a row never
 * jumps out from under a finger.
 *
 * Controlled: the parent's draft holds the answer.
 */
export interface AttendanceSheetProps {
  value: EventAttendanceDraft;
  onChange: (next: EventAttendanceDraft) => void;
  /**
   * False drops Required from the answers, for a member who may make events
   * but not require attendance; a row already Required keeps it so its answer
   * stays visible (`attendanceChoices`).
   */
  allowRequired?: boolean;
}

export const AttendanceSheet = forwardRef<
  BottomSheetModal,
  AttendanceSheetProps
>(function AttendanceSheet({ value, onChange, allowRequired = true }, ref) {
  const backgroundStyle = useSheetBackgroundStyle();
  const tall = useTallSheetProps();
  const close = useSheetClose(ref);

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tall}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={close} />
      {/* gorhom mounts a modal's children only while it is presented, so the
          body's state (the search, the row order) starts fresh each visit. */}
      <AttendanceBody
        value={value}
        onChange={onChange}
        allowRequired={allowRequired}
        onDone={close}
      />
    </BottomSheetModal>
  );
});

/** One row of the list, as `attendanceRows` draws it. */
type AttendanceRow = { id: string; name: string };

interface AttendanceBodyProps {
  value: EventAttendanceDraft;
  onChange: (next: EventAttendanceDraft) => void;
  allowRequired: boolean;
  onDone: () => void;
}

function AttendanceBody({
  value,
  onChange,
  allowRequired,
  onDone,
}: AttendanceBodyProps) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  const rolesQuery = useRoles();
  const [search, setSearch] = useState("");
  // The roles set apart as the sheet opens lead the list for this visit.
  const [pinned] = useState(() => Object.keys(value.roles));

  const options = useMemo(
    () => roleOptionsFrom(rolesQuery.data),
    [rolesQuery.data],
  );
  // Until the roles load, a set-apart id can't be told from a deleted one.
  const missingName = rolesQuery.isSuccess ? "Removed role" : "Role";
  const nameOf = useMemo(() => {
    const byId = new Map(options.map((role) => [role.id, role.name]));
    return (id: string) => byId.get(id) ?? missingName;
  }, [options, missingName]);
  const rows = useMemo(
    () => attendanceRows(options, pinned, search, missingName),
    [options, pinned, search, missingName],
  );
  const alumniId = alumniRoleIdOf(rolesQuery.data);
  const searchable = options.length > ATTENDANCE_SEARCH_FROM;
  const choices = (current: EventAttendanceStatus) =>
    attendanceChoices(current, allowRequired).map((status) => ({
      value: status,
      label: EVENT_ATTENDANCE_LABELS[status],
    }));

  const header = (
    <View style={styles.header}>
      <TallSheetHeader
        title="Who's coming"
        onClose={onDone}
        doneAccent={brand.accent}
      />
      <Text
        style={styles.summary}
        numberOfLines={2}
        accessibilityLiveRegion="polite"
      >
        {describeAttendance(value, nameOf)}
      </Text>
      <View style={[styles.row, styles.everyoneRow]}>
        <Text style={styles.everyoneName} numberOfLines={1}>
          Everyone else
        </Text>
        <View style={styles.choice}>
          <Segmented
            options={choices(value.everyone)}
            value={value.everyone}
            onChange={(everyone: EventAttendanceStatus) =>
              onChange(withEveryone(value, everyone))
            }
            accessibilityLabel="Attendance for everyone else"
            dense
          />
        </View>
      </View>
      {rolesQuery.isError && rows.length > 0 ? (
        <Text style={styles.note}>
          Couldn&apos;t load your chapter&apos;s roles, so role names may be
          missing.
        </Text>
      ) : null}
      {searchable ? (
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
      ) : null}
    </View>
  );

  return (
    <BottomSheetFlatList
      onAccessibilityEscape={onDone}
      data={rows}
      keyExtractor={(role: AttendanceRow) => role.id}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListHeaderComponent={header}
      stickyHeaderIndices={[0]}
      ListEmptyComponent={
        <Text style={styles.caption}>
          {rolesQuery.isPending
            ? "Loading roles…"
            : rolesQuery.isError
              ? "Couldn't load your chapter's roles."
              : options.length === 0
                ? "Your chapter has no roles yet."
                : "No roles match that search."}
        </Text>
      }
      renderItem={({ item }: { item: AttendanceRow }) => {
        const setApart = item.id in value.roles;
        const current = attendanceOfRole(value, item.id);
        const note =
          item.id === alumniId && !setApart && value.everyone !== "not_invited"
            ? ALUMNI_FOLLOWING_NOTE
            : null;
        return (
          <View style={[styles.row, styles.roleRow]}>
            <View style={styles.nameColumn}>
              <Text
                style={[styles.roleName, setApart ? null : styles.following]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {note ? (
                <Text style={styles.note} numberOfLines={2}>
                  {note}
                </Text>
              ) : null}
            </View>
            <View style={styles.choice}>
              <Segmented
                options={choices(current)}
                value={current}
                onChange={(next: EventAttendanceStatus) =>
                  onChange(withRole(value, item.id, next))
                }
                quiet={!setApart}
                dense
                accessibilityLabel={`Attendance for ${item.name}`}
              />
            </View>
          </View>
        );
      }}
    />
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    content: {
      paddingBottom: tokens.spacing.xl,
    },
    header: {
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.sm,
      // Sticky: rows scroll under it, so it is painted.
      backgroundColor: tokens.color.surface.popover,
    },
    summary: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      // Two lines held, so a longer rule never pushes the rows down (P4).
      minHeight:
        2 *
        (tokens.typography.role.body.lineHeight ??
          tokens.typography.role.body.size * 1.5),
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
    },
    field: fieldStyles.field,
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
    },
    everyoneRow: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    everyoneName: {
      flex: 1,
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    roleRow: {
      paddingHorizontal: tokens.spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    nameColumn: {
      flex: 1,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    roleName: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    following: {
      color: tokens.color.text.mutedForeground,
    },
    // Wide enough for "Not invited" in full at the caption size.
    choice: {
      width: 228,
    },
  });
}

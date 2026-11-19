import { forwardRef, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import {
  useChapterRoster,
  useMarkAttendanceByHand,
  type MeetingMinutes,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import { MEETING_ATTENDANCE_COPY } from "@repo/validation";
import { CheckGlyph } from "@/components/control-glyphs";
import { Segmented } from "@/components/segmented";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetPrimaryButton,
  SheetScrim,
  TallSheetHeader,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";
import { typeRole, useFrappTheme } from "@/lib/theme";

type Status = "PRESENT" | "LATE" | "EXCUSED";

/**
 * Mark who was at a meeting by hand, from the minutes' ⋯ menu (#5562),
 * for the meeting nobody checked in to (`spec/behavior/events.md` § Marking
 * attendance by hand). Web's `attendance-backfill.tsx` is its twin, with the
 * same words (`MEETING_ATTENDANCE_COPY`). One request marks everyone picked;
 * someone already marked shows and can't be picked, so a check-in is never
 * overwritten. Like every officer mark it moves no points.
 */
export const MarkAttendanceSheet = forwardRef<
  BottomSheetModal,
  {
    eventId: string;
    attendees: MeetingMinutes["attendees"];
    onMarked: (line: string) => void;
  }
>(function MarkAttendanceSheet({ eventId, attendees, onMarked }, ref) {
  const backgroundStyle = useSheetBackgroundStyle();
  const tall = useTallSheetProps();
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const [visit, setVisit] = useState(0);
  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tall}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => setVisit((value) => value + 1)}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        stickyHeaderIndices={[0]}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TallSheetHeader
            title={MEETING_ATTENDANCE_COPY.title}
            onClose={closeSheet}
          />
        </View>
        <Picker
          key={visit}
          eventId={eventId}
          attendees={attendees}
          onMarked={(line) => {
            onMarked(line);
            closeSheet();
          }}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function Picker({
  eventId,
  attendees,
  onMarked,
}: {
  eventId: string;
  attendees: MeetingMinutes["attendees"];
  onMarked: (line: string) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const roster = useChapterRoster();
  const mark = useMarkAttendanceByHand();
  const [filter, setFilter] = useState("");
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Status>("PRESENT");
  const [problem, setProblem] = useState<string | null>(null);

  const already = useMemo(
    () =>
      new Set([
        ...(attendees?.present ?? []),
        ...(attendees?.late ?? []),
        ...(attendees?.excused ?? []),
      ]),
    [attendees],
  );
  const members = useMemo(
    () =>
      (roster.data ?? [])
        .map((row) => ({
          id: row.user_id,
          name: memberLabel(row.display_name, row.user_id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [roster.data],
  );
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? members.filter((member) => member.name.toLowerCase().includes(needle))
    : members;
  const pickable = shown.filter((member) => !already.has(member.id));
  const allShownPicked =
    pickable.length > 0 && pickable.every((member) => picked.has(member.id));

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleShown() {
    setPicked((current) => {
      const next = new Set(current);
      for (const member of pickable) {
        if (allShownPicked) next.delete(member.id);
        else next.add(member.id);
      }
      return next;
    });
  }

  async function save() {
    const userIds = [...picked].filter((id) => !already.has(id));
    if (userIds.length === 0) return;
    setProblem(null);
    try {
      const result = await mark.mutateAsync({ eventId, userIds, status });
      onMarked(
        [
          MEETING_ATTENDANCE_COPY.marked(result.marked.length),
          result.not_invited > 0
            ? MEETING_ATTENDANCE_COPY.notInvited(result.not_invited)
            : null,
        ]
          .filter(Boolean)
          .join(". "),
      );
    } catch (error) {
      setProblem(errorCopy(error, MEETING_ATTENDANCE_COPY.failed));
    }
  }

  return (
    <>
      <Text style={styles.hint}>{MEETING_ATTENDANCE_COPY.body}</Text>
      <Segmented
        accessibilityLabel={MEETING_ATTENDANCE_COPY.statusLabel}
        value={status}
        onChange={setStatus}
        options={[
          { value: "PRESENT", label: "Present" },
          { value: "LATE", label: "Late" },
          { value: "EXCUSED", label: "Excused" },
        ]}
      />
      <BottomSheetTextInput
        value={filter}
        onChangeText={setFilter}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={MEETING_ATTENDANCE_COPY.find}
        placeholderTextColor={tokens.color.text.muted}
        accessibilityLabel={MEETING_ATTENDANCE_COPY.find}
        style={[styles.field, focused ? styles.fieldFocused : null]}
      />
      <View>
        <CheckRow
          label={
            needle
              ? MEETING_ATTENDANCE_COPY.pickShown(pickable.length)
              : MEETING_ATTENDANCE_COPY.pickEveryone
          }
          checked={allShownPicked}
          disabled={pickable.length === 0}
          strong
          onPress={toggleShown}
        />
        {shown.map((member) => (
          <CheckRow
            key={member.id}
            label={member.name}
            detail={
              already.has(member.id)
                ? MEETING_ATTENDANCE_COPY.alreadyMarked
                : undefined
            }
            checked={picked.has(member.id) || already.has(member.id)}
            disabled={already.has(member.id)}
            onPress={() => toggle(member.id)}
          />
        ))}
      </View>
      {problem ? (
        <Text accessibilityLiveRegion="polite" style={styles.problem}>
          {problem}
        </Text>
      ) : null}
      <SheetPrimaryButton
        label={MEETING_ATTENDANCE_COPY.save(picked.size, status)}
        busy={mark.isPending}
        disabled={mark.isPending || picked.size === 0}
        onPress={() => void save()}
        accent={accent}
        onAccent={accentOnPrimary}
      />
    </>
  );
}

function CheckRow({
  label,
  detail,
  checked,
  disabled = false,
  strong = false,
  onPress,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  disabled?: boolean;
  strong?: boolean;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View
        style={[
          styles.box,
          checked && { backgroundColor: accent, borderColor: accent },
          disabled && styles.disabled,
        ]}
      >
        {checked ? (
          <CheckGlyph color={tokens.color.surface.background} size={12} />
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={[styles.rowLabel, strong && styles.strong]}
      >
        {label}
      </Text>
      {detail ? <Text style={styles.hint}>{detail}</Text> : null}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    ...sheetFieldStyles(tokens, accent),
    body: {
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
    },
    header: {
      backgroundColor: tokens.color.surface.popover,
    },
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: 44,
    },
    rowLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    strong: {
      fontWeight: "600",
    },
    box: {
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: tokens.color.border.control,
    },
    disabled: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}

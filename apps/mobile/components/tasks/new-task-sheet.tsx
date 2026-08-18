import { forwardRef, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterRoster, useCreateTask, useViewerUserId } from "@repo/hooks";
import { avatarRadius, tint, typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { initialsFor, records, str } from "@/lib/more/narrow";
import { FilterChips } from "@/components/filter-chips";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  useSheetBackgroundStyle,
} from "@/components/sheet-scaffold";
import { CalendarGlyph } from "@/components/tasks/task-glyphs";
import { TITLE_MAX_LENGTH } from "@/lib/tasks/limits";
import {
  duePresets,
  formatDueFieldLabel,
  localIsoDate,
  parsePointReward,
  validateNewTask,
} from "@/lib/tasks/create-task";

/**
 * s19 — the "New task" bottom sheet (`canvas-screens.dc.html`, `id="s19"`).
 *
 * Creation is a bottom sheet by rule, not by preference:
 * `spec/ui/mobile/README.md` § Native-feel rules binds "new task" to
 * `@gorhom/bottom-sheet` v5. Mechanics mirror `app/(tabs)/service-hours.tsx`,
 * the sheet C4 landed — `BottomSheetTextInput` throughout, because a plain
 * `TextInput` breaks the sheet's keyboard coordination.
 *
 * ## Two deviations from the drawing, both forced
 *
 * **The date is presets, not a free field.** No date-picker dependency exists
 * and `package.json` is frozen under #937's hotspot protocol — see the header of
 * `lib/tasks/create-task.ts` for the full reasoning.
 *
 * **The focus ring is a border, not a shadow.** Canvas draws
 * `box-shadow: 0 0 0 3px rgba(239,182,59,.22)`. React Native has no
 * `box-shadow`, and drop shadows are banned outright by the De-Google
 * guardrails. Rendered instead as a wrapping view carrying `focus.ringWidth` /
 * `focus.ringOpacity` — the first consumer of those tokens, which existed for
 * exactly this and had no caller.
 */

export interface NewTaskSheetProps {
  /** Injected so the presets are deterministic under test. */
  now?: Date;
  /** Fired after a successful create, with the assignee's name for the confirmation. */
  onCreated?: (assigneeName: string | null, wasSelf: boolean) => void;
}

interface RosterMember {
  userId: string;
  name: string | null;
}

function selectRoster(data: unknown): RosterMember[] {
  return records(data)
    .map((row) => {
      const userId = str(row, "user_id");
      return userId ? { userId, name: str(row, "display_name") } : null;
    })
    .filter((row): row is RosterMember => row !== null);
}

export const NewTaskSheet = forwardRef<BottomSheetModal, NewTaskSheetProps>(
  function NewTaskSheet({ now, onCreated }, ref) {
    const { tokens } = useFrappTheme();
    const { accent } = useChapterBranding();
    const styles = createStyles(tokens);
    const backgroundStyle = useSheetBackgroundStyle();

    const viewerUserId = useViewerUserId();
    const rosterQuery = useChapterRoster();
    const createTask = useCreateTask();

    // Read once per mount rather than per render, so the presets cannot shift
    // under the member mid-edit.
    const at = useMemo(() => now ?? new Date(), [now]);
    const presets = useMemo(() => duePresets(at), [at]);

    const [title, setTitle] = useState("");
    const [pointsInput, setPointsInput] = useState("");
    const [dueDate, setDueDate] = useState(() => localIsoDate(at));
    // Defaults to the viewer, so the common case needs no picker interaction.
    const [assigneeId, setAssigneeId] = useState<string | null>(null);
    const [titleFocused, setTitleFocused] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [submitFailed, setSubmitFailed] = useState(false);

    const roster = useMemo(
      () => selectRoster(rosterQuery.data),
      [rosterQuery.data],
    );

    const effectiveAssigneeId = assigneeId ?? viewerUserId;
    const assignee = roster.find((row) => row.userId === effectiveAssigneeId);
    const assigneeName = assignee?.name ?? null;

    const draft = {
      title,
      dueDate,
      assigneeId: effectiveAssigneeId,
      pointsInput,
    };
    const body = validateNewTask(draft);
    const pointsInvalid = parsePointReward(pointsInput).kind === "invalid";
    const canSubmit = body !== null && !createTask.isPending;

    const reset = useCallback(() => {
      setTitle("");
      setPointsInput("");
      setDueDate(localIsoDate(at));
      setAssigneeId(null);
      setPickerOpen(false);
      setSearch("");
      setSubmitFailed(false);
      setTitleFocused(false);
    }, [at]);

    const dismiss = useCallback(() => {
      if (typeof ref === "function" || !ref?.current) return;
      ref.current.dismiss();
    }, [ref]);

    const cancel = useCallback(() => {
      reset();
      dismiss();
    }, [reset, dismiss]);

    const submit = useCallback(() => {
      if (!body) return;
      setSubmitFailed(false);
      createTask.mutate(body, {
        onSuccess: () => {
          const wasSelf = body.assignee_id === viewerUserId;
          reset();
          dismiss();
          onCreated?.(assigneeName, wasSelf);
        },
        onError: () => setSubmitFailed(true),
      });
    }, [
      body,
      createTask,
      viewerUserId,
      reset,
      dismiss,
      onCreated,
      assigneeName,
    ]);

    const filteredRoster = useMemo(() => {
      const needle = search.trim().toLowerCase();
      if (needle.length === 0) return roster;
      return roster.filter((row) =>
        (row.name ?? "").toLowerCase().includes(needle),
      );
    }, [roster, search]);

    return (
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        onDismiss={reset}
      >
        <BottomSheetView style={styles.body}>
          <SheetHeader title="New task" onCancel={cancel} />

          {/* The focus ring is the wrapper, not the field — see the header. It
              tracks real focus rather than "has text", which would leave the
              ring lit on a filled field nobody is editing. */}
          <View style={[styles.ring, titleFocused ? styles.ringActive : null]}>
            <BottomSheetTextInput
              value={title}
              onChangeText={setTitle}
              onFocus={() => setTitleFocused(true)}
              onBlur={() => setTitleFocused(false)}
              placeholder="Collect ride-share forms"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Task title"
              maxLength={TITLE_MAX_LENGTH}
              style={[
                styles.field,
                titleFocused ? styles.fieldFocused : null,
              ]}
            />
          </View>

          <View style={styles.splitRow}>
            <View style={[styles.field, styles.splitField]}>
              <CalendarGlyph color={tokens.color.text.mutedForeground} />
              <Text style={styles.fieldValue}>
                {formatDueFieldLabel(dueDate)}
              </Text>
            </View>

            <View style={[styles.field, styles.splitField]}>
              <Text style={[styles.pointsSign, { color: accent }]}>+</Text>
              <BottomSheetTextInput
                value={pointsInput}
                onChangeText={setPointsInput}
                placeholder="pts"
                placeholderTextColor={tokens.color.text.muted}
                accessibilityLabel="Point reward"
                keyboardType="number-pad"
                style={styles.pointsInput}
              />
            </View>
          </View>

          <FilterChips
            chips={presets.map((preset) => ({
              value: preset.date,
              label: preset.label,
            }))}
            selected={dueDate}
            onSelect={(value) => value && setDueDate(value)}
            accessibilityLabel="Due date"
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Assignee: ${assigneeName ?? "you"}`}
            accessibilityHint="Choose who this task is for."
            accessibilityState={{ expanded: pickerOpen }}
            onPress={() => setPickerOpen((open) => !open)}
            style={styles.assigneeRow}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {initialsFor(assigneeName)}
              </Text>
            </View>
            <Text style={styles.fieldValue} numberOfLines={1}>
              {assigneeName ?? "You"}
            </Text>
            <Text style={styles.assigneeHint}>assignee</Text>
          </Pressable>

          {pickerOpen ? (
            <>
              {/* Deliberately NOT `SearchField` from `components/filter-chips.tsx`:
                  that renders a plain `TextInput`, and inside a gorhom sheet a
                  plain input breaks the sheet's keyboard coordination —
                  `patterns.md` makes `BottomSheetTextInput` mandatory here. The
                  chrome matches the sheet's own fields rather than the
                  directory's search box. */}
              <BottomSheetTextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search members"
                placeholderTextColor={tokens.color.text.muted}
                accessibilityLabel="Search members"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.field}
              />
              {/* A sheet-aware list: a plain FlatList nested in a gorhom sheet
                  loses the sheet's pan gesture, the same class of rule as
                  BottomSheetTextInput. */}
              <BottomSheetFlatList
                data={filteredRoster}
                keyExtractor={(row: RosterMember) => row.userId}
                style={styles.picker}
                renderItem={({ item }: { item: RosterMember }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: item.userId === effectiveAssigneeId,
                    }}
                    onPress={() => {
                      setAssigneeId(item.userId);
                      setPickerOpen(false);
                      setSearch("");
                    }}
                    style={styles.pickerRow}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {initialsFor(item.name)}
                      </Text>
                    </View>
                    <Text style={styles.fieldValue} numberOfLines={1}>
                      {item.name ?? "Member"}
                    </Text>
                  </Pressable>
                )}
              />
            </>
          ) : null}

          {pointsInvalid ? (
            <Text style={styles.error}>
              Points must be a whole number, up to 100,000.
            </Text>
          ) : null}

          {submitFailed ? (
            <Text style={styles.error}>
              That didn&apos;t save. Your task is still here — try again.
            </Text>
          ) : null}

          <SheetPrimaryButton
            label={createTask.isPending ? "Creating…" : "Create task"}
            onPress={submit}
            disabled={!canSubmit}
            accent={accent}
            onAccent={tokens.color.gold.onHouse}
          />
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    ring: {
      borderRadius: tokens.radius.control + tokens.focus.ringWidth,
      borderWidth: tokens.focus.ringWidth,
      borderColor: "transparent",
    },
    ringActive: {
      borderColor: tint(tokens.color.gold.house, tokens.focus.ringOpacity),
    },
    field: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    fieldFocused: {
      borderColor: tokens.color.gold.house,
    },
    splitRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    splitField: {
      flex: 1,
    },
    fieldValue: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    pointsSign: {
      ...typeRole(tokens.typography.role.label),
    },
    pointsInput: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    assigneeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    assigneeHint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    avatar: {
      width: 26,
      height: 26,
      borderRadius: avatarRadius(26),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      // TODO-DESIGN: Canvas draws these initials at 10.5px/700; `caption` is
      // 12.5/400 and is the smallest role available.
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    picker: {
      maxHeight: 220,
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}

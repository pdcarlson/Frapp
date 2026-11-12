import { useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { SignetTokens } from "@repo/theme/signet";
import {
  REPEAT_PRESETS,
  REPEAT_PRESET_LABELS,
  WEEKDAY_CODES,
  editRepeatDraft,
  monthlyChoices,
  pickRepeatEnd,
  pickRepeatPreset,
  repeatCaption,
  repeatDays,
  toggleRepeatDay,
  type RepeatDraft,
  type RepeatPreset,
  type WeekdayCode,
} from "@repo/validation";
import { fieldTypeRole, typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { Chip, FilterChips } from "@/components/filter-chips";

/**
 * The New event sheet's Repeat section (#4488, #3662): the preset chips, and
 * under a cadence its options, open rather than behind Google Calendar's
 * "Custom…" step (Shawn, 2026-11-12): the weekday chips and "Every N weeks"
 * for Weekly, "Every N months" and what day for Monthly, and Ends (after N
 * meetings, or on a date) for every cadence. The state and the rule it makes
 * are `@repo/validation`'s `repeat-draft.ts`, which the web editor shares.
 */
export function RepeatOptions({
  draft,
  start,
  onChange,
  disabled,
  error,
  showCaption,
  platform = Platform.OS,
}: {
  draft: RepeatDraft;
  /** The series' first meeting, which the defaults and caption read. */
  start: Date;
  onChange: (next: RepeatDraft) => void;
  disabled: boolean;
  /** A save's refusal, shown in place of the caption. */
  error?: string;
  /** Whether to say how long the series runs. */
  showCaption: boolean;
  platform?: string;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  const [focused, setFocused] = useState<"interval" | "count" | null>(null);

  const caption = repeatCaption(draft, start);
  // A problem the officer can see as they type is said at once; the length
  // only once the series differs from the one saved.
  const line =
    error ??
    (caption?.problem ? caption.text : showCaption ? caption?.text : null);

  const unit =
    draft.preset === "DAILY"
      ? "day"
      : draft.preset === "WEEKLY"
        ? "week"
        : "month";
  const interval = draft.intervalInput.trim();

  return (
    <>
      <Text style={styles.sectionLabel}>Repeat</Text>
      <FilterChips
        chips={REPEAT_PRESETS.map((preset) => ({
          value: preset,
          label: REPEAT_PRESET_LABELS[preset],
        }))}
        selected={draft.preset}
        onSelect={(value) => {
          if (disabled || value === null) return;
          onChange(pickRepeatPreset(draft, value as RepeatPreset));
        }}
        accessibilityLabel="Repeat"
      />

      {draft.preset === "NONE" ? null : (
        <View style={styles.group}>
          {draft.preset === "WEEKLY" ? (
            <>
              <View
                style={styles.days}
                accessibilityRole="none"
                accessibilityLabel="Repeats on"
              >
                {WEEKDAY_CODES.map((code) => {
                  const on = repeatDays(draft, start).includes(code);
                  return (
                    <Chip
                      key={code}
                      label={DAY_LETTER[code]}
                      on={on}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled }}
                      accessibilityLabel={DAY_NAME[code]}
                      onPress={() => {
                        if (!disabled) {
                          onChange(toggleRepeatDay(draft, code, start));
                        }
                      }}
                    />
                  );
                })}
              </View>
              <View style={styles.divider} />
            </>
          ) : null}

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Every</Text>
            <BottomSheetTextInput
              value={draft.intervalInput}
              onChangeText={(intervalInput) =>
                onChange(editRepeatDraft(draft, { intervalInput }))
              }
              onFocus={() => setFocused("interval")}
              onBlur={() => setFocused(null)}
              editable={!disabled}
              keyboardType="number-pad"
              selectTextOnFocus
              accessibilityLabel={`Repeat every how many ${unit}s`}
              style={[
                styles.number,
                focused === "interval" ? styles.numberFocused : null,
              ]}
            />
            <Text style={styles.rowLabel}>
              {interval === "1" ? unit : `${unit}s`}
            </Text>
          </View>

          {draft.preset === "MONTHLY" ? (
            <>
              <View style={styles.divider} />
              <View style={styles.chipRow}>
                <Text style={styles.rowLabel}>On</Text>
                <View style={styles.chips}>
                  <FilterChips
                    chips={monthlyChoices(draft, start).map((choice) => ({
                      value: choice.by,
                      label: choice.label,
                    }))}
                    selected={
                      monthlyChoices(draft, start).some(
                        (c) => c.by === draft.monthlyBy,
                      )
                        ? draft.monthlyBy
                        : "date"
                    }
                    onSelect={(value) => {
                      if (disabled || value === null) return;
                      onChange(
                        editRepeatDraft(draft, {
                          monthlyBy: value as RepeatDraft["monthlyBy"],
                        }),
                      );
                    }}
                    accessibilityLabel="Repeats on"
                  />
                </View>
              </View>
            </>
          ) : null}

          <View style={styles.divider} />
          <View style={styles.chipRow}>
            <Text style={styles.rowLabel}>Ends</Text>
            <View style={styles.chips}>
              <FilterChips
                chips={[
                  { value: "count", label: "After" },
                  { value: "until", label: "On date" },
                ]}
                selected={draft.endKind}
                onSelect={(value) => {
                  if (disabled || value === null) return;
                  onChange(
                    pickRepeatEnd(
                      draft,
                      value as RepeatDraft["endKind"],
                      start,
                    ),
                  );
                }}
                accessibilityLabel="Ends"
              />
            </View>
          </View>
          <View style={styles.row}>
            {draft.endKind === "count" ? (
              <>
                <BottomSheetTextInput
                  value={draft.countInput}
                  onChangeText={(countInput) =>
                    onChange(editRepeatDraft(draft, { countInput }))
                  }
                  onFocus={() => setFocused("count")}
                  onBlur={() => setFocused(null)}
                  editable={!disabled}
                  keyboardType="number-pad"
                  selectTextOnFocus
                  accessibilityLabel="Ends after how many meetings"
                  style={[
                    styles.number,
                    focused === "count" ? styles.numberFocused : null,
                  ]}
                />
                <Text style={styles.rowLabel}>meetings</Text>
              </>
            ) : (
              <UntilPicker
                value={draft.until}
                minimum={start}
                disabled={disabled}
                platform={platform}
                onChange={(until) =>
                  onChange(editRepeatDraft(draft, { until }))
                }
              />
            )}
          </View>
        </View>
      )}

      {line ? (
        <Text
          style={
            line === error || caption?.problem ? styles.error : styles.caption
          }
          accessibilityLiveRegion="polite"
        >
          {line}
        </Text>
      ) : null}
    </>
  );
}

const DAY_LETTER: Record<WeekdayCode, string> = {
  SU: "S",
  MO: "M",
  TU: "T",
  WE: "W",
  TH: "T",
  FR: "F",
  SA: "S",
};
const DAY_NAME: Record<WeekdayCode, string> = {
  SU: "Sunday",
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
};

/** `YYYY-MM-DD` as a local Date at noon, clear of any DST edge. */
function dateOfDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function dayOfDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The series' last day: iOS's compact date pill, else a pill. */
function UntilPicker({
  value,
  minimum,
  disabled,
  platform,
  onChange,
}: {
  value: string;
  minimum: Date;
  disabled: boolean;
  platform: string;
  onChange: (day: string) => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  const date = dateOfDay(value) ?? minimum;
  const label = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (platform === "ios") {
    return (
      <>
        <View>
          <DateTimePicker
            value={date}
            mode="date"
            display="compact"
            themeVariant="dark"
            accentColor={brand.accent}
            minimumDate={minimum}
            disabled={disabled}
            accessibilityLabel={`Ends on, ${label}`}
            onValueChange={(_event, picked) => onChange(dayOfDate(picked))}
          />
        </View>
      </>
    );
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ends on, ${label}`}
        accessibilityHint="Opens the date picker."
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          Keyboard.dismiss();
          DateTimePickerAndroid.open({
            value: date,
            mode: "date",
            minimumDate: minimum,
            onValueChange: (_event, picked) => onChange(dayOfDate(picked)),
          });
        }}
        style={styles.pill}
      >
        <Text style={styles.rowLabel}>{label}</Text>
      </Pressable>
    </>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const rowText = {
    ...typeRole(tokens.typography.role.body),
    color: tokens.color.text.foreground,
  };
  return StyleSheet.create({
    sectionLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.xs,
    },
    // The same grouped rows as the options above it.
    group: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.color.border.hairline,
    },
    days: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: tokens.spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
    },
    chipRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
    },
    rowLabel: rowText,
    chips: { flex: 1 },
    // A number in a row, as the Points field sets it.
    number: {
      minWidth: 52,
      minHeight: 34,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: 0,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: "transparent",
      backgroundColor: tokens.color.surface.popover,
      textAlign: "center",
      ...fieldTypeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    numberFocused: { borderColor: accent },
    pill: {
      minHeight: 34,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}

import { useState, type ComponentType } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import {
  ACCENT_PRESETS,
  normalizeAccentInput,
  type AccentSwatch,
} from "@repo/hooks/chapter-identity";
import { useFieldReveal } from "@repo/hooks/field-reveal";
import { SignetTokens } from "@repo/theme/signet";
import { sheetFieldStyles } from "@/components/sheet-scaffold";
import { MONO_FONT_FAMILY, typeRole, useFrappTheme } from "@/lib/theme";
import { eyebrowStyle } from "@/components/eyebrow";

/**
 * The chapter accent picker. One component for every place an officer sets the accent on mobile: the
 * create-chapter wizard and Settings → Chapter.
 *
 * Swatches, not a hex field: the organization's own colors first
 * (`orgColorsFor` in `@repo/org-archetypes`), then the common presets
 * (`ACCENT_PRESETS`), with a typed hex behind "Custom color" for a chapter
 * whose color is neither. The owner's note that started this: "nobody wants
 * to type a hex".
 *
 * A swatch shows the seed exactly as stored. The app paints the shades the
 * accent engine derives from it (lighter, for a dark seed on dark surfaces;
 * `accent-engine.md`), which a member sees as soon as a save lands.
 *
 * It never reads or shows Greek letters: some organizations don't display
 * them (`spec/behavior/branding.md` § Chapter mark).
 */

export type AccentPickerProps = {
  /** The current accent, `#RRGGBB`. */
  value: string;
  /** Called with a normalized `#RRGGBB` whenever a swatch or a valid hex is chosen. */
  onChange: (hex: string) => void;
  /**
   * Called with `false` while the custom field holds text that is not a color
   * yet, and `true` once it is again (or a swatch is tapped). `onChange` keeps
   * the last valid color meanwhile, so a caller that saves refuses to save on
   * `false` rather than saving a color the field no longer shows. It refuses
   * on press, with `showError`, and keeps its save pressable: a greyed save
   * over a hint that waits for blur says nothing (components.md § Text input,
   * "When an error shows").
   */
  onValidityChange?: (valid: boolean) => void;
  /**
   * The caller tried to save: the custom field's hint shows now if the field
   * isn't a color yet, without waiting for the member to leave it.
   */
  showError?: boolean;
  /** What a screen reader calls the group of swatches. */
  label?: string;
  /** The organization's official colors, shown first. Empty or absent hides the row. */
  orgColors?: readonly AccentSwatch[];
  disabled?: boolean;
  /**
   * The text input the custom field renders. Inside a bottom sheet pass
   * `BottomSheetTextInput`, which keeps the field above the keyboard.
   */
  inputComponent?: ComponentType<TextInputProps>;
  /**
   * The custom field's border while it has focus (components.md § Text
   * input): house gold in setup, where there is no chapter yet, and the
   * chapter accent in Settings. Required, so no caller paints the wrong one
   * by leaving it out.
   */
  focusColor: string;
};

const HEX_PATTERN = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#RRGGBB` for a typed hex, or null while it isn't one yet. */
export function parseTypedHex(text: string): string | null {
  const trimmed = text.trim();
  return HEX_PATTERN.test(trimmed) ? normalizeAccentInput(trimmed) : null;
}

function sameHex(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

export function AccentPicker({
  value,
  onChange,
  onValidityChange,
  label = "Accent color",
  orgColors = [],
  disabled = false,
  showError = false,
  inputComponent: Input = TextInput,
  focusColor,
}: AccentPickerProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens, focusColor);
  const [hexFocused, setHexFocused] = useState(false);
  // "#4" is on its way to "#4F2683": the hint waits for the member to leave
  // the field (components.md § Text input, "When an error shows").
  const reveal = useFieldReveal<"hex">();

  // A preset the organization already offers is shown once, under the
  // organization, so one color is never two radios in the same group.
  const presets = ACCENT_PRESETS.filter(
    (preset) => !orgColors.some((swatch) => sameHex(swatch.hex, preset.hex)),
  );
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const draftInvalid = draft.trim() !== "" && parseTypedHex(draft) === null;

  // A color that is none of the swatches on screen still gets one, so the
  // picker never holds a color it doesn't show. "Current" is what the chapter
  // held when the picker opened (the house default, the directory's
  // placeholder, an earlier typed hex), kept so it can be picked again.
  // "Selected" is a chosen color the swatches lost: in the wizard, editing
  // the organization name drops its colors from under a picked one. A hex
  // typed into the open field shows in the field's own preview instead.
  const visible = [...orgColors, ...presets];
  const [initialValue] = useState(value);
  const extras: AccentSwatch[] = [];
  if (!visible.some((swatch) => sameHex(swatch.hex, initialValue))) {
    extras.push({ name: "Current", hex: initialValue });
  }
  if (
    draft.trim() === "" &&
    !sameHex(value, initialValue) &&
    !visible.some((swatch) => sameHex(swatch.hex, value))
  ) {
    extras.push({ name: "Selected", hex: value });
  }

  function pick(hex: string) {
    if (disabled) return;
    setDraft("");
    onValidityChange?.(true);
    onChange(normalizeAccentInput(hex));
  }

  function typeHex(text: string) {
    setDraft(text);
    const parsed = parseTypedHex(text);
    // An emptied field isn't an error: the last color stands.
    onValidityChange?.(parsed !== null || text.trim() === "");
    if (parsed) onChange(parsed);
  }

  function renderSwatch(swatch: AccentSwatch, labelled: boolean) {
    const selected = sameHex(swatch.hex, value);
    return (
      <Pressable
        key={`${swatch.name}-${swatch.hex}`}
        accessibilityRole="radio"
        accessibilityLabel={swatch.name}
        accessibilityState={{ checked: selected, disabled }}
        disabled={disabled}
        hitSlop={4}
        onPress={() => pick(swatch.hex)}
        style={({ pressed }) => [
          labelled ? styles.labelledSwatch : null,
          pressed ? styles.pressed : null,
        ]}
      >
        <View style={[styles.ring, selected ? styles.ringSelected : null]}>
          <View style={[styles.dot, { backgroundColor: swatch.hex }]} />
        </View>
        {labelled ? (
          <Text style={styles.swatchName} numberOfLines={2}>
            {swatch.name}
          </Text>
        ) : null}
      </Pressable>
    );
  }

  return (
    <View
      style={styles.root}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {extras.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Current</Text>
          <View style={styles.row}>
            {extras.map((swatch) => renderSwatch(swatch, true))}
          </View>
        </View>
      ) : null}

      {orgColors.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Your organization</Text>
          <View style={styles.row}>
            {orgColors.map((swatch) => renderSwatch(swatch, true))}
          </View>
        </View>
      ) : null}

      <View style={styles.group}>
        <Text style={styles.groupLabel}>
          {orgColors.length > 0 || extras.length > 0 ? "More colors" : "Colors"}
        </Text>
        <View style={styles.row}>
          {presets.map((swatch) => renderSwatch(swatch, false))}
        </View>
      </View>

      {customOpen ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Custom color</Text>
          <View style={styles.customRow}>
            <View
              accessibilityLabel="Custom color preview"
              style={[
                styles.customPreview,
                {
                  backgroundColor:
                    parseTypedHex(draft) ?? tokens.color.surface.surface1,
                },
              ]}
            />
            <Input
              value={draft}
              onChangeText={typeHex}
              placeholder="e.g. #4F2683"
              placeholderTextColor={tokens.color.text.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              editable={!disabled}
              accessibilityLabel="Custom color hex"
              // The field mounts when "Custom color…" is tapped, so focusing
              // it then saves the second tap that tap was asking for.
              autoFocus
              onFocus={() => setHexFocused(true)}
              onBlur={() => {
                setHexFocused(false);
                reveal.blur("hex");
              }}
              style={[
                styles.input,
                styles.inputFlex,
                hexFocused ? styles.inputFocused : null,
              ]}
            />
          </View>
          {draftInvalid && (showError || reveal.shows("hex")) ? (
            <Text style={styles.helperText}>
              Enter six hex digits, like #4F2683.
            </Text>
          ) : null}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Custom color"
          accessibilityHint="Opens a field for a hex color."
          disabled={disabled}
          hitSlop={8}
          onPress={() => setCustomOpen(true)}
          style={({ pressed }) => [
            styles.customLink,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.customLinkText}>Custom color…</Text>
        </Pressable>
      )}
    </View>
  );
}

const DOT = 36;
const RING_GAP = 3;

function createStyles(tokens: SignetTokens, focusColor: string) {
  // The sheets' field, so a fix to components.md § Text input lands here too:
  // 44pt, the height of the swatch preview beside it, in mono for the hex.
  const field = sheetFieldStyles(tokens, focusColor);
  return StyleSheet.create({
    root: { gap: tokens.spacing.md },
    group: { gap: tokens.spacing.sm },
    groupLabel: {
      ...eyebrowStyle(tokens),
      // Web's accent swatches draw these groups in `text-muted-foreground`.
      color: tokens.color.text.mutedForeground,
    },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
    },
    labelledSwatch: {
      width: 72,
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    ring: {
      width: DOT + 2 * (RING_GAP + 2),
      height: DOT + 2 * (RING_GAP + 2),
      borderRadius: (DOT + 2 * (RING_GAP + 2)) / 2,
      borderWidth: 2,
      borderColor: "transparent",
      alignItems: "center",
      justifyContent: "center",
    },
    ringSelected: { borderColor: tokens.color.text.foreground },
    dot: {
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    swatchName: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
    pressed: { opacity: 0.7 },
    customRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    customPreview: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    input: {
      ...field.field,
      fontFamily: MONO_FONT_FAMILY,
    },
    inputFocused: field.fieldFocused,
    inputFlex: { flex: 1 },
    helperText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    customLink: { alignSelf: "flex-start" },
    customLinkText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
  });
}

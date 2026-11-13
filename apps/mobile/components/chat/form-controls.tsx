import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import { DisclosureGlyph } from "@/components/control-glyphs";

/**
 * The two controls the phone's forms share (#3926 step 3): a choice row, a
 * radio or a checkbox, and an inline picker, a row that opens its choices in
 * place. The New form sheet picks a question's type with the picker; the
 * form page draws multiple choice, checkboxes and yes/no as choice rows and a
 * dropdown as the picker, as Google Forms' phone page opens a dropdown's
 * list over the question rather than on a page of its own.
 */

export function PickRow({
  label,
  selected,
  many,
  disabled = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  /** A checkbox, else a radio. */
  many: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  return (
    <Pressable
      accessibilityRole={many ? "checkbox" : "radio"}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled ? styles.pressed : null,
        disabled && !selected ? styles.dim : null,
      ]}
    >
      <View
        style={[
          many ? styles.box : styles.radio,
          selected ? { borderColor: brand.accentPrimary } : styles.markOff,
        ]}
      >
        {selected ? (
          <View
            style={[
              many ? styles.boxFill : styles.radioFill,
              { backgroundColor: brand.accentPrimary },
            ]}
          />
        ) : null}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

export function InlinePicker<T extends string>({
  label,
  options,
  value,
  placeholder = "Choose",
  onPick,
  disabled = false,
  invalid = false,
}: {
  /** What the picker answers, for a screen reader: "Question type". */
  label: string;
  options: readonly { id: T; label: string }[];
  value: T | null;
  placeholder?: string;
  onPick: (id: T) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const [open, setOpen] = useState(false);
  const shown = options.find((option) => option.id === value)?.label ?? null;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: shown ?? placeholder }}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen((was) => !was)}
        style={({ pressed }) => [
          styles.picker,
          invalid ? styles.pickerInvalid : null,
          pressed && !disabled ? styles.pressed : null,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.pickerValue, shown ? null : styles.placeholder]}
        >
          {shown ?? placeholder}
        </Text>
        {disabled ? null : (
          <DisclosureGlyph
            color={tokens.color.text.mutedForeground}
            direction={open ? "up" : "down"}
            size={18}
          />
        )}
      </Pressable>
      {open && !disabled ? (
        <View style={styles.list}>
          {options.map((option) => (
            <PickRow
              key={option.id}
              label={option.label}
              selected={option.id === value}
              many={false}
              onPress={() => {
                onPick(option.id);
                setOpen(false);
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const MARK = 20;

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.xs,
      borderRadius: tokens.radius.control,
    },
    pressed: {
      backgroundColor: tokens.color.surface.popover,
    },
    dim: {
      opacity: 0.55,
    },
    radio: {
      width: MARK,
      height: MARK,
      borderRadius: MARK / 2,
      borderWidth: 2,
      alignItems: "center",
      justifyContent: "center",
    },
    radioFill: {
      width: MARK / 2,
      height: MARK / 2,
      borderRadius: MARK / 4,
    },
    box: {
      width: MARK,
      height: MARK,
      borderRadius: 4,
      borderWidth: 2,
      alignItems: "center",
      justifyContent: "center",
    },
    boxFill: {
      width: MARK / 2,
      height: MARK / 2,
      borderRadius: 2,
    },
    markOff: {
      borderColor: tokens.color.border.control,
    },
    label: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    picker: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.control,
    },
    pickerInvalid: {
      borderColor: tokens.color.semantic.destructive,
    },
    pickerValue: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    placeholder: {
      color: tokens.color.text.muted,
    },
    list: {
      marginTop: tokens.spacing.xs,
      paddingLeft: tokens.spacing.xs,
      borderLeftWidth: 2,
      borderLeftColor: brand.accentPrimary,
    },
  });
}

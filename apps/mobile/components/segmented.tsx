import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * A small segmented control: two to four choices, one held, every choice in
 * view (`spec/ui/design-system/components.md` § Segmented control). For a
 * choice with a handful of answers that a form row sets in one tap, where a
 * menu would hide the current answer behind a press.
 *
 * The held segment carries the chapter accent as a tint, so its state reads at
 * a glance and the control never changes size between states (P4).
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  disabled = false,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={styles.track}
    >
      {options.map((option) => {
        const held = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: held, disabled }}
            disabled={disabled}
            onPress={() => {
              if (!held) onChange(option.value);
            }}
            hitSlop={{ top: 6, bottom: 6 }}
            style={[
              styles.segment,
              held
                ? { backgroundColor: tint(accent, 0.18), borderColor: accent }
                : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.label, held ? { color: accent } : null]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    track: {
      flexDirection: "row",
      gap: 2,
      padding: 2,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.surface1,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
    },
    segment: {
      flex: 1,
      minHeight: 32,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.sm,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: "transparent",
    },
    label: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}

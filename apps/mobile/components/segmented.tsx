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
 * a glance and the control never changes size between states (P4). `quiet`
 * holds it in neutral ink instead, for a row whose answer only follows a
 * default set elsewhere (Who's coming's roles that follow "Everyone else"),
 * so the rows that were set apart are the ones lit.
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
  quiet = false,
  dense = false,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  quiet?: boolean;
  /** Tighter segment padding, for a row that sets the control beside a name. */
  dense?: boolean;
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
              dense ? styles.dense : null,
              held
                ? quiet
                  ? styles.quietHeld
                  : { backgroundColor: tint(accent, 0.18), borderColor: accent }
                : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                held
                  ? quiet
                    ? styles.quietHeldLabel
                    : { color: accent }
                  : null,
              ]}
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
    // Each segment takes its label's width plus an equal share of the rest,
    // so the longest answer ("Not invited") is never cut short.
    dense: {
      flexBasis: "auto",
      paddingHorizontal: tokens.spacing.xs,
    },
    quietHeld: {
      backgroundColor: tokens.color.surface.card,
      borderColor: tokens.color.border.input,
    },
    quietHeldLabel: {
      color: tokens.color.text.foreground,
    },
  });
}

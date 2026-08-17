import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The chip row and search field s12 and s13 both draw.
 *
 * Shared for the same reason `state-block.tsx` and `list-section.tsx` are: two
 * screens had byte-identical `chip` / `chipIdle` / `chipText` /
 * `chipTextSelected` style blocks and near-identical `Pressable` maps around
 * them, which is exactly the duplication those components were added to stop.
 */

export interface FilterChip {
  /** Stable key, and what `onSelect` receives. `null` is the "all" chip. */
  value: string | null;
  label: string;
  /** Appended as `· N` when present, as drawn on s13. */
  count?: number | null;
}

export function FilterChips({
  chips,
  selected,
  onSelect,
  accessibilityLabel,
}: {
  chips: readonly FilterChip[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  accessibilityLabel?: string;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={styles.chipRow}
    >
      {chips.map((chip) => {
        const isSelected = selected === chip.value;
        return (
          <Pressable
            key={chip.value ?? "__all"}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(chip.value)}
            style={[
              styles.chip,
              isSelected ? { backgroundColor: accent } : styles.chipIdle,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                isSelected ? styles.chipTextSelected : null,
              ]}
            >
              {/* A count is omitted rather than shown as `· 0` while its query
                  is still loading — a populated tab must not advertise empty. */}
              {chip.count === null || chip.count === undefined
                ? chip.label
                : `${chip.label} · ${chip.count}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={tokens.color.text.muted}
      accessibilityLabel={accessibilityLabel}
      autoCapitalize="none"
      autoCorrect={false}
      style={styles.search}
    />
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
    },
    chip: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.lg,
      borderRadius: tokens.radius.chipLarge,
    },
    chipIdle: {
      backgroundColor: tokens.color.surface.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    chipText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    chipTextSelected: {
      color: tokens.color.gold.onHouse,
    },
    search: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
  });
}

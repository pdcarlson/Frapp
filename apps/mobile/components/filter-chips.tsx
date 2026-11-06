import { ReactNode } from "react";
import {
  type AccessibilityRole,
  type AccessibilityState,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { PressableRow } from "@/components/list-section";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The chip row and search field s12 and s13 both draw.
 *
 * Shared for the same reason `state-block.tsx` and `list-section.tsx` are: two
 * screens had byte-identical `chip` / `chipIdle` / `chipText` /
 * `chipTextSelected` style blocks and near-identical `Pressable` maps around
 * them, which is exactly the duplication those components were added to stop.
 *
 * ## One row that scrolls, on the screens that ask for it
 *
 * A chapter's folders wrapped into three rows of tall chips on s12 and pushed
 * the first document halfway down the screen. So s12 and s13 pass `scroll`,
 * and their chips are one row that scrolls sideways, bleeding to the screen
 * edge so a cut-off chip says there is more. Without it the chips wrap, as
 * they always did: that is what a sheet wants, where the chips are a form
 * field among others and a sideways scroll would fight the sheet's own pan,
 * and it is the default so a sheet needs no prop to keep it.
 *
 * ## Compact, with a 44pt touch target
 *
 * The board draws these chips about 34pt tall (s13), not the 44pt they used to
 * be. That is the chip's floor (a large system text size grows it), and
 * `hitSlop` carries the touch target the rest of the way to `touch.minimum`,
 * as Ask's answer card and the sheet header's Cancel do. The rows and
 * scrollers pad themselves by the slop and pull it back with a negative
 * margin, because Android drops a touch outside a clipping parent's bounds,
 * a scroller's among them, whatever a child's `hitSlop` says (the clip that
 * rounds each chip's ripple takes the slop too, in `PressableRow`).
 */

/**
 * The chip height, as a floor: 32, the mobile filter chip on foundations.md
 * §9's control size scale (s13 draws 34). No token carries it; the 44pt floor
 * is `hitSlop`'s.
 */
const CHIP_HEIGHT = 32;

export interface FilterChip {
  /** Stable key, and what `onSelect` receives. `null` is the "all" chip. */
  value: string | null;
  label: string;
  /** Appended as `· N` when present, as drawn on s13. */
  count?: number | null;
}

/**
 * One chip, for a control that sits beside a chip row rather than in it
 * (Directory's Filters). `FilterChips` and `ToggleChips` draw theirs with it.
 *
 * On: the chapter's solid accent with its own label colour, as components.md
 * §3 paints a control that stays on. Off: `surface1` with a hairline, the
 * tone of the lists below. Pressing an off chip ripples on Android and lifts
 * a step on iOS (`usePressFeedback`, through `PressableRow`). An on chip ripples on Android and holds
 * still on iOS: its fill is the state, and the lift would paint over it.
 */
export function Chip({
  label,
  on,
  onPress,
  accessibilityRole,
  accessibilityState,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  accessibilityRole: AccessibilityRole;
  accessibilityState: AccessibilityState;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const { tokens } = useFrappTheme();
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const slop = (tokens.touch.minimum - CHIP_HEIGHT) / 2;

  return (
    // A rounded control, so it goes through `PressableRow`: the chip can't
    // round its own ripple, and a clip on the chip itself would also have to
    // fix its height.
    <PressableRow
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={{ top: slop, bottom: slop }}
      onPress={onPress}
      lifts={!on}
      style={[
        styles.chip,
        on ? { backgroundColor: accentPrimary } : styles.chipIdle,
      ]}
    >
      <Text style={[styles.chipText, on ? { color: accentOnPrimary } : null]}>
        {label}
      </Text>
    </PressableRow>
  );
}

/**
 * The row the chips sit in: a wrapping row by default, or a sideways scroller
 * for a screen that passes `scroll`. Either way it pads itself by the chips'
 * touch slop and takes that back with a negative margin, so the slop is
 * inside its bounds and the layout around it doesn't move.
 */
function ChipRow({
  scroll,
  children,
}: {
  scroll: boolean;
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  if (!scroll) {
    return (
      <View style={[styles.slop, styles.wrapOuter, styles.wrapRow]}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Lets a chip take a tap while a search field holds the keyboard, as
      // far as this scroller decides: every ScrollView above it decides too.
      // On s13 the FlatList above it also passes "handled", so the tap lands.
      // On s12 ScreenShell's ScrollView keeps the default and takes the first
      // tap to close the keyboard, so the chip needs a second one until the
      // shell passes "handled" itself (#3427).
      keyboardShouldPersistTaps="handled"
      style={styles.scroller}
      contentContainerStyle={[styles.slop, styles.scrollRow]}
    >
      {children}
    </ScrollView>
  );
}

export function FilterChips({
  chips,
  selected,
  onSelect,
  accessibilityLabel,
  scroll = false,
  trailing,
}: {
  chips: readonly FilterChip[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  accessibilityLabel?: string;
  /**
   * One row that scrolls sideways instead of rows that wrap: for a screen
   * whose chips would otherwise push its list down (s12, s13). A sheet leaves
   * it off.
   */
  scroll?: boolean;
  /**
   * A control drawn after the tabs, in the same row but outside the tab list
   * (Directory's Filters chip).
   */
  trailing?: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <ChipRow scroll={scroll}>
      <View
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
        style={scroll ? styles.tabs : [styles.wrapRow, styles.wrapTabs]}
      >
        {chips.map((chip) => (
          <Chip
            key={chip.value ?? "__all"}
            accessibilityRole="tab"
            accessibilityState={{ selected: selected === chip.value }}
            on={selected === chip.value}
            onPress={() => onSelect(chip.value)}
            // A count is omitted rather than shown as `· 0` while its query
            // is still loading — a populated tab must not advertise empty.
            label={
              chip.count === null || chip.count === undefined
                ? chip.label
                : `${chip.label} · ${chip.count}`
            }
          />
        ))}
      </View>
      {trailing}
    </ChipRow>
  );
}

/**
 * Chips that switch on and off independently, in `FilterChips`' recipe: s04's
 * Unread only and Hide muted (#2877), which can both be on at once, so they are
 * switches rather than one tab list. They wrap rather than scroll: there are
 * two of them, and a scroller would only add a gesture.
 */
export function ToggleChips<K extends string>({
  chips,
  onToggle,
}: {
  chips: readonly { key: K; label: string; on: boolean }[];
  onToggle: (key: K, next: boolean) => void;
}) {
  return (
    <ChipRow scroll={false}>
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          accessibilityRole="switch"
          accessibilityState={{ checked: chip.on }}
          accessibilityLabel={chip.label}
          label={chip.label}
          on={chip.on}
          onPress={() => onToggle(chip.key, !chip.on)}
        />
      ))}
    </ChipRow>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  autoCapitalize = "none",
  keyboardType = "default",
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  /** Free-text fields (city, company) read better with word-casing than the
   * search-field default of "none". */
  autoCapitalize?: "none" | "words";
  /** "number-pad" for a graduation-year filter; the default suits free text. */
  keyboardType?: "default" | "number-pad";
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
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      keyboardType={keyboardType}
      style={styles.search}
    />
  );
}

function createStyles(tokens: SignetTokens) {
  const slop = (tokens.touch.minimum - CHIP_HEIGHT) / 2;
  return StyleSheet.create({
    slop: {
      paddingVertical: slop,
    },
    // Bleeds to the screen edge: the gutter moves inside the scroller, so the
    // first chip lines up with the content and the row runs off the side.
    scroller: {
      flexGrow: 0,
      marginVertical: -slop,
      marginHorizontal: -tokens.spacing.lg,
    },
    scrollRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
    },
    tabs: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    // Rows a slop apart and then some, so one row's touch slop doesn't reach
    // into the next row's chips.
    wrapRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: tokens.spacing.sm,
      rowGap: tokens.spacing.md,
    },
    wrapOuter: {
      marginVertical: -slop,
    },
    // The tab list takes the whole line, so its own chips have a width to
    // wrap within.
    wrapTabs: {
      width: "100%",
    },
    // A floor, not a fixed height: at a large system text size the label
    // outgrows 32pt and the chip grows with it rather than cutting it off.
    chip: {
      minHeight: CHIP_HEIGHT,
      minWidth: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chipLarge,
    },
    chipIdle: {
      backgroundColor: tokens.color.surface.surface1,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    chipText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
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

import { ReactNode, useRef, type Ref, type RefObject } from "react";
import {
  type AccessibilityRole,
  type AccessibilityState,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { SearchGlyph } from "@/components/control-glyphs";
import { PressableRow } from "@/components/list-section";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useRaisedSurfaces } from "@/lib/surfaces";
import { fieldTypeRole, typeRole, useFrappTheme } from "@/lib/theme";

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
  /** A small glyph before the label, e.g. s12's pin or star (#3934). */
  mark?: ReactNode;
  /**
   * A long press's action, e.g. s12's folder actions (#3934). Also offered
   * as a named accessibility action, so it is never press-and-hold only.
   */
  onLongPress?: () => void;
  /** The spoken name of `onLongPress`'s action. */
  longPressLabel?: string;
}

/**
 * One chip, for a control that sits beside a chip row rather than in it
 * (Directory's Filters). `FilterChips` draws its chips with it.
 *
 * On: the chapter's solid accent with its own label colour, as components.md
 * §3 paints a control that stays on. Off: `surface1` with a hairline, the
 * input step; a chip drawn on a card passes `onCard` and takes the step above
 * that card instead (`lib/surfaces.ts`), since `surface1` on a screen's card
 * is the card's own fill. Pressing an off chip ripples on Android and lifts
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
  mark,
  onLongPress,
  longPressLabel,
  onLayout,
  onCard = false,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  accessibilityRole: AccessibilityRole;
  accessibilityState: AccessibilityState;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  mark?: ReactNode;
  onLongPress?: () => void;
  longPressLabel?: string;
  /** Where the chip landed, for a row that scrolls to its lit chip. */
  onLayout?: (event: LayoutChangeEvent) => void;
  /** The chip is drawn on a card, not on a screen or a sheet's own fill. */
  onCard?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const surfaces = useRaisedSurfaces();
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
      onLayout={onLayout}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={
        onLongPress
          ? [{ name: "longpress", label: longPressLabel ?? "More actions" }]
          : undefined
      }
      onAccessibilityAction={
        onLongPress
          ? (event) => {
              if (event.nativeEvent.actionName === "longpress") onLongPress();
            }
          : undefined
      }
      // The idle chip's own fill is the input step, on a screen and in a
      // sheet, and the step above the card when it is drawn on one.
      onControl
      onCard={onCard}
      lifts={!on}
      style={[
        styles.chip,
        mark ? styles.chipWithMark : null,
        on
          ? { backgroundColor: accentPrimary }
          : [
              styles.chipIdle,
              onCard ? { backgroundColor: surfaces.raised } : null,
            ],
      ]}
    >
      {mark}
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
  scrollRef,
  onScrollerLayout,
  children,
}: {
  scroll: boolean;
  scrollRef?: RefObject<ScrollView | null>;
  onScrollerLayout?: (event: LayoutChangeEvent) => void;
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
      ref={scrollRef}
      onLayout={onScrollerLayout}
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

/**
 * A scrolling row opens with its lit chip in view (#4402): a screen that
 * remembers its chip (Activity) can open on the sixth or seventh, which
 * starts off the edge of a narrow phone, and then nothing on screen says a
 * filter is on. Once, when the row and that chip have both been laid out, it
 * scrolls just far enough to show the chip with a little of the one before
 * it; a chip already in view moves nothing. Later picks are the member's own
 * scrolling, so it never moves the row again.
 */
function useRevealSelectedChip(scroll: boolean, lead: number) {
  const scrollRef = useRef<ScrollView | null>(null);
  const width = useRef<number | null>(null);
  const chip = useRef<{ x: number; width: number } | null>(null);
  const done = useRef(false);

  const tryReveal = () => {
    if (!scroll || done.current || width.current === null || !chip.current) {
      return;
    }
    done.current = true;
    const { x, width: chipWidth } = chip.current;
    if (x + chipWidth > width.current) {
      scrollRef.current?.scrollTo({
        x: Math.max(0, x - lead),
        animated: false,
      });
    }
  };

  return {
    scrollRef,
    onScrollerLayout: (event: LayoutChangeEvent) => {
      width.current = event.nativeEvent.layout.width;
      tryReveal();
    },
    onSelectedLayout: (event: LayoutChangeEvent) => {
      const { x, width: chipWidth } = event.nativeEvent.layout;
      chip.current = { x, width: chipWidth };
      tryReveal();
    },
  };
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
  const reveal = useRevealSelectedChip(scroll, tokens.spacing.lg);

  return (
    <ChipRow
      scroll={scroll}
      scrollRef={reveal.scrollRef}
      onScrollerLayout={reveal.onScrollerLayout}
    >
      <View
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
        style={scroll ? styles.tabs : [styles.wrapRow, styles.wrapTabs]}
      >
        {chips.map((chip) => (
          <Chip
            key={chip.value ?? "__all"}
            onLayout={
              selected === chip.value ? reveal.onSelectedLayout : undefined
            }
            accessibilityRole="tab"
            accessibilityState={{ selected: selected === chip.value }}
            on={selected === chip.value}
            onPress={() => onSelect(chip.value)}
            mark={chip.mark}
            onLongPress={chip.onLongPress}
            longPressLabel={chip.longPressLabel}
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

export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  autoCapitalize = "none",
  keyboardType = "default",
  searchGlyph = false,
  inputRef,
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
  /** Leads the field with a magnifier, for a search rather than a filter
   * value (#4137): web's search fields and iOS's search bar draw one. */
  searchGlyph?: boolean;
  /** For a screen that focuses the field from elsewhere, as Messages' pencil
   * does (#4668). */
  inputRef?: Ref<TextInput>;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const input = (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={tokens.color.text.muted}
      accessibilityLabel={accessibilityLabel}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      keyboardType={keyboardType}
      style={[styles.search, searchGlyph ? styles.searchWithGlyph : null]}
    />
  );
  if (!searchGlyph) return input;
  return (
    <View>
      {input}
      {/* Decorative: the field's own label names it. */}
      <View pointerEvents="none" style={styles.searchGlyph}>
        <SearchGlyph color={tokens.color.text.muted} size={SEARCH_GLYPH_SIZE} />
      </View>
    </View>
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
    // A chip with a pin or star before its label (#3934): the two sit in a
    // row with the label, a hair apart.
    chipWithMark: {
      flexDirection: "row",
      gap: tokens.spacing.xs,
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
      borderColor: tokens.color.border.control,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      ...fieldTypeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    // Room for the glyph: its inset, its width, then the field's own gap.
    searchWithGlyph: {
      paddingLeft: tokens.spacing.md + SEARCH_GLYPH_SIZE + tokens.spacing.sm,
    },
    searchGlyph: {
      position: "absolute",
      left: tokens.spacing.md,
      top: 0,
      bottom: 0,
      justifyContent: "center",
    },
  });
}

/** Web's toolbar search glyph is 16px (`h-4 w-4`). */
const SEARCH_GLYPH_SIZE = 16;

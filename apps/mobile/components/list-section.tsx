import { ReactNode, useMemo } from "react";
import {
  ActivityIndicator,
  type DimensionValue,
  Platform,
  Pressable,
  type PressableAndroidRippleConfig,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { SkeletonText } from "@/components/state-block";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { eyebrowStyle } from "@/components/eyebrow";
import { guardedBySwipe, useSwipeClaim } from "@/lib/swipe-claim";

/**
 * The grouped-list chrome the reference draws on s09, s12, s14, s15 and s16: an
 * uppercase section caption over a rounded container whose rows are separated
 * by inset hairlines.
 *
 * Shared because five screens draw it and `components/screen-shell.tsx` — which
 * would otherwise be the place — is frozen under #937's hotspot protocol.
 *
 * ## Type roles, not the drawn pixel sizes
 *
 * Canvas draws these rows at 15.5/600 and their trailing values at 13.5, and
 * section captions at 12–13/700. None of those is in the Signet type scale, and
 * `spec/ui/design-system/foundations.md` calls an off-scale size a defect — so
 * each maps to its nearest role (`label` for a row title, `caption` for a
 * trailing value and a section caption) rather than hard-coding the drawing.
 * The reference also disagrees with itself here: s09's admin caption is
 * 12px/0.7 letter-spacing with a 4px indent while s12/s14/s16 use 13px/0.6 with
 * none, and nothing documents which is canonical.
 */

export function SectionHeader({
  children,
  count,
}: {
  children: string;
  /**
   * How many rows the section holds, drawn after the caption as a separate
   * muted count, as web's `SectionLabel` draws it, rather than inside the
   * caption's own text. Omit it (or pass `null`) for nothing to count.
   */
  count?: number | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  if (count == null)
    return <Text style={styles.sectionHeader}>{children}</Text>;
  return (
    // One element to a screen reader, "Needs you, 8", as the caption and its
    // count were when the count was part of the caption's text.
    <View
      accessible
      accessibilityLabel={`${children}, ${count}`}
      style={styles.sectionHeaderRow}
    >
      <Text style={styles.sectionHeader}>{children}</Text>
      <SectionCount count={count} />
    </View>
  );
}

/**
 * A section's count, drawn beside its heading as a separate muted number, the
 * way web's `SectionLabel` draws it. {@link SectionHeader}'s `count` draws
 * one; a smaller heading inside a section (Activity's "Now" and "Later")
 * draws its own with this, so the count's tone and size live in one place.
 */
export function SectionCount({ count }: { count: number }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return <Text style={styles.sectionHeaderCount}>{String(count)}</Text>;
}

/**
 * A {@link SectionHeader} that hasn't loaded, for a screen whose captions come
 * from its data (Notifications' Today / Earlier). A screen whose caption is
 * fixed draws the real {@link SectionHeader} in its skeleton instead.
 */
export function SectionHeaderSkeleton({
  width = "18%",
}: {
  width?: DimensionValue;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <SkeletonText
      role={tokens.typography.role.caption}
      width={width}
      style={styles.sectionHeaderSkeleton}
    />
  );
}

/** Label widths, cycled, so a placeholder list doesn't read as a grid. */
const ROW_LABEL_WIDTHS = ["52%", "38%", "60%", "44%"] as const;

/**
 * A {@link ListRow} that hasn't loaded, on the row's own padding and line
 * boxes, so a `ListSection` of these is as tall as the one it becomes. Placed
 * inside a real {@link ListSection}, which draws the frame and the inset
 * hairlines, inside a `SkeletonRegion` (`components/state-block.tsx`).
 */
export function ListRowSkeleton({
  index = 0,
  description = false,
  variant = "default",
}: {
  /** The row's place in its list, which picks its label width. */
  index?: number;
  /** Draw the caption line a row with a `description` carries. */
  description?: boolean;
  /** `detail`: a short label on the left and the value on the right. */
  variant?: "default" | "detail";
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { label, caption } = tokens.typography.role;
  const width = ROW_LABEL_WIDTHS[index % ROW_LABEL_WIDTHS.length];

  if (variant === "detail") {
    return (
      <View style={styles.row}>
        <SkeletonText role={label} width="22%" />
        <View style={styles.rowSkeletonValue}>
          <SkeletonText role={label} width={width} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <SkeletonText role={label} width={width} />
        {description ? <SkeletonText role={caption} width="30%" /> : null}
      </View>
    </View>
  );
}

/** A rounded container whose children are separated by inset hairlines. */
export function ListSection({ children }: { children: ReactNode }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const items = Array.isArray(children) ? children.flat() : [children];
  const visible = items.filter(Boolean);

  return (
    <View style={styles.section}>
      {/* Keyed by position: these rows are a fixed, ordered list declared per
          screen, never reordered at runtime, and carry no id of their own. */}
      {visible.map((child, index) => (
        <View key={index}>
          {index > 0 ? <View style={styles.divider} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/**
 * A pressable row's accessibility hint: its description, then any explicit
 * hint, each read as its own sentence and never twice. The description is the
 * second line a sighted member reads under the label; without this a screen
 * reader heard only the label (#2257 review).
 */
export function listRowHint(
  description: string | null | undefined,
  accessibilityHint: string | undefined,
): string | undefined {
  const parts = [description, accessibilityHint].filter(
    (part, index, all): part is string => !!part && all.indexOf(part) === index,
  );
  if (parts.length === 0) return undefined;
  return parts
    .map((part) => (/[.!?…]$/.test(part) ? part : `${part}.`))
    .join(" ");
}

/**
 * A list row's press feedback. The rule is `spec/ui/mobile/README.md`
 * § Native-feel rules: a row that answers a press uses this hook, so searching
 * for it finds them, and a row that draws its own press state is the exception.
 * This is only the mechanism.
 *
 * `ripple` goes to `android_ripple` (iOS ignores it). The ripple fills the
 * row's rectangle, so a row that wants its feedback to clear the text pads
 * itself rather than relying on a parent. `lift(pressed)` goes into the
 * `style` callback: on iOS it fills the row with a higher surface while it is
 * held, and on Android it returns nothing, since the ripple is already the
 * signal.
 *
 * A row's own `borderRadius` does not round its ripple, and neither does
 * `overflow: "hidden"` on the row itself. React Native 0.86 paints the ripple
 * as the view's background (a `RippleDrawable` with a rectangular mask), and a
 * view's `overflow` clips only its children, in `dispatchDraw`, after that
 * background is drawn. What rounds it is a parent with the radius and
 * `overflow: "hidden"`, which clips the child's whole drawing, background
 * included. A rounded row therefore renders through {@link PressableRow},
 * which adds that parent; `ListRow` gets it from `ListSection`. A square row
 * can take the hook directly.
 *
 * The default lift is `surface.card`: a row on the screen background rises to
 * it. A row that sits on a `surface.card` fill (a `ListRow` in its
 * `ListSection`, the More profile card, or an event card) passes `onCard` and
 * lifts to `surface.popover` instead: a card lifted to its
 * own colour shows nothing.
 */
export type PressFeedback = {
  ripple: PressableAndroidRippleConfig;
  lift: (pressed: boolean) => ViewStyle | null;
};

export function usePressFeedback({
  onCard = false,
}: { onCard?: boolean } = {}): PressFeedback {
  const { tokens } = useFrappTheme();
  return useMemo(() => {
    const lifted: ViewStyle | null =
      Platform.OS === "android"
        ? null
        : {
            backgroundColor: onCard
              ? tokens.color.surface.popover
              : tokens.color.surface.card,
          };
    return {
      ripple: { color: tint(tokens.color.text.foreground, 0.12) },
      lift: (pressed: boolean) => (pressed ? lifted : null),
    };
  }, [tokens, onCard]);
}

/**
 * The gutter bleed a list row on the screen background takes: it pads itself
 * by `sm` and pulls that `sm` back out into the screen gutter, so its content
 * stays on the gutter line while its press feedback (ripple or lift) clears
 * the content on both sides instead of stopping flush with it. One value for
 * every such row, because the alignment holds only while they all bleed the
 * same: Chat home's section header and Hidden toggle, its channel rows and UP
 * NEXT rows line their captions, sigils and glyphs up on that line, and the
 * Directory's member rows keep the gutter Chat home does.
 *
 * `rounded` adds the control radius a rounded row's lift and clip take; a
 * square row (a member row, split by hairlines) passes `false`.
 */
export function gutterBleed(
  tokens: SignetTokens,
  { rounded = true }: { rounded?: boolean } = {},
): ViewStyle {
  return {
    paddingHorizontal: tokens.spacing.sm,
    marginHorizontal: -tokens.spacing.sm,
    ...(rounded ? { borderRadius: tokens.radius.control } : null),
  };
}

export type PressableRowProps = Omit<
  PressableProps,
  "style" | "android_ripple" | "children"
> & {
  style?: StyleProp<ViewStyle>;
  /** The row is itself a card: see {@link usePressFeedback}'s `onCard`. */
  onCard?: boolean;
  /**
   * `false` keeps the iOS lift off, for a control whose fill is its state (an
   * on chip): the lift would paint over it. The Android ripple still answers.
   */
  lifts?: boolean;
  children?: ReactNode;
};

/**
 * A rounded row that answers a press: a `Pressable` carrying
 * {@link usePressFeedback}'s ripple and lift, inside a clip `View` that rounds
 * the ripple (see that hook for why the row cannot round it itself).
 *
 * `style` is the row's resting style, written as it would be on a bare
 * `Pressable`. The clip takes the row's outer margins, so a row that bleeds
 * into the screen gutter still sits where it did, and copies its corner radius;
 * the row keeps the radius too, for its own border and iOS lift. Any other
 * outer layout (`flex`, `alignSelf`, a position) would also belong on the clip,
 * and no row passes one yet. Everything else goes to the `Pressable` as given.
 *
 * Inside a screen-wide swipe (Chat home's swipe to Messages), the row drops a
 * press or long press that came from the swipe's own touch: a full-width row
 * never sees the finger leave it, so it would take the release as a tap
 * (`lib/swipe-claim.ts`).
 */
export function PressableRow({
  style,
  onCard = false,
  lifts = true,
  children,
  ...pressable
}: PressableRowProps) {
  const feedback = usePressFeedback({ onCard });
  const claim = useSwipeClaim();
  const { clip, row } = splitRowStyle(style);
  return (
    // The clip takes the row's `hitSlop` too: Android hands a touch to a
    // child only inside its `overflow: "hidden"` parent's bounds, and the
    // slop is what extends those bounds.
    <View style={clip} hitSlop={pressable.hitSlop}>
      <Pressable
        {...pressable}
        onPress={guardedBySwipe(claim, pressable.onPress)}
        onLongPress={guardedBySwipe(claim, pressable.onLongPress)}
        android_ripple={pressable.disabled ? undefined : feedback.ripple}
        style={({ pressed }) => [row, lifts ? feedback.lift(pressed) : null]}
      >
        {children}
      </Pressable>
    </View>
  );
}

/** Splits a row's style into the clip's part (margins, radius) and the row's. */
function splitRowStyle(style: StyleProp<ViewStyle>): {
  clip: ViewStyle;
  row: ViewStyle;
} {
  const clip: Record<string, unknown> = { overflow: "hidden" };
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(StyleSheet.flatten(style) ?? {})) {
    if (key.startsWith("margin")) {
      clip[key] = value;
    } else if (
      key.startsWith("flex") &&
      key !== "flexDirection" &&
      key !== "flexWrap"
    ) {
      // How the row sizes against its siblings (`flex`, `flexGrow`,
      // `flexShrink`, `flexBasis`) belongs to the clip, the parent's actual
      // child. Left on the inner row, a `flex: 1` row in a horizontal parent
      // shrank to its content and squeezed a flexing label to zero width: the
      // chat home's section names vanished (2026-11-07). The clip is a
      // column, so the row only grows to fill it; a basis would size it
      // vertically.
      clip[key] = value;
      row.flexGrow = 1;
    } else {
      if (key.startsWith("border") && key.endsWith("Radius")) clip[key] = value;
      row[key] = value;
    }
  }
  return { clip: clip as ViewStyle, row: row as ViewStyle };
}

export type ListRowProps = {
  label: string;
  /**
   * A leading glyph, drawn before the label. The You tab's rows carry one
   * (s09); the other grouped lists draw none.
   */
  leading?: ReactNode;
  /** Trailing static text — a value the member reads but cannot change here. */
  value?: string | null;
  /** A second line under the label. */
  description?: string | null;
  /**
   * `destructive` draws the second line in the destructive hue, for a row
   * whose state is a failure (an upload that didn't go through). The label
   * keeps its colour, so the row reads as the same thing, now stuck.
   */
  descriptionTone?: "default" | "destructive";
  /** Trailing control (a switch, a swatch) instead of, or beside, `value`. */
  trailing?: ReactNode;
  onPress?: () => void;
  /**
   * A secondary action behind a long press (Documents' Delete, #3938), as
   * chat's channel rows put theirs. A screen reader reaches it as a named
   * action, `longPressLabel`, so it is never press-and-hold only.
   */
  onLongPress?: () => void;
  /** The spoken name of `onLongPress`'s action, e.g. "Delete document". */
  longPressLabel?: string;
  accessibilityHint?: string;
  /**
   * What a screen reader reads as the row's value when the trailing status is
   * a drawn element (a count badge, a chip) rather than `value` text. Defaults
   * to `value`.
   */
  accessibilityValue?: string;
  /** Renders the label in the destructive hue. Does not itself confirm anything. */
  destructive?: boolean;
  /**
   * The row does its thing in place (Reply, Delete, Block, Sign out) rather
   * than opening another screen or sheet, so it draws no chevron. A chevron
   * promises somewhere to go, and on an action row it promises wrong
   * (`spec/ui/design-system/components.md` § Chrome weight).
   */
  action?: boolean;
  /**
   * The row can't be used now: the label greys out and the chevron goes. For a
   * row that is unavailable, not for one that is working (`busy`).
   */
  disabled?: boolean;
  /**
   * The row's own action is running (a document opening, a DM being started).
   * The label keeps its colour and a small spinner takes the chevron's slot,
   * so only the tapped row changes and nothing reflows. It takes no second
   * press while busy. `disabled` used to stand in for this, which greyed the
   * row out as if it were unavailable, and on Documents greyed every row at
   * once with nothing marking the one that was opening.
   */
  busy?: boolean;
  /**
   * `detail` is a read-only fact row, as s15 draws Profile's Details: the label
   * is the quiet half (regular weight, muted) and the value the one a member
   * reads (foreground, at the label's weight). The default row is the other
   * way round, because there the label names what a tap does.
   */
  variant?: "default" | "detail";
};

export function ListRow({
  label,
  leading,
  value,
  description,
  descriptionTone = "default",
  trailing,
  onPress,
  onLongPress,
  longPressLabel,
  accessibilityHint,
  accessibilityValue,
  destructive = false,
  action = false,
  disabled = false,
  busy = false,
  variant = "default",
}: ListRowProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const feedback = usePressFeedback({ onCard: true });
  const detail = variant === "detail";

  const content = (
    <View style={styles.row}>
      {leading}
      <View style={[styles.rowText, detail ? styles.rowTextDetail : null]}>
        <Text
          style={[
            styles.rowLabel,
            detail ? styles.rowLabelDetail : null,
            destructive ? styles.rowLabelDestructive : null,
            disabled ? styles.rowLabelDisabled : null,
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={[
              styles.rowDescription,
              descriptionTone === "destructive"
                ? styles.rowDescriptionDestructive
                : null,
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={detail ? styles.rowValueDetail : styles.rowValue}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {onPress && busy ? (
        // In the chevron's slot, so nothing else on the row moves.
        <ActivityIndicator
          size="small"
          color={tokens.color.text.muted}
          style={styles.trailingSlot}
        />
      ) : onPress && !disabled && !action ? (
        <Text style={styles.chevron}>›</Text>
      ) : null}
    </View>
  );

  if (!onPress) return content;

  // The Pressable is one accessibility element, so the texts inside it are not
  // read on their own: the label names it, the trailing value is its value,
  // and the description goes into the hint (`listRowHint`).
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={
        (accessibilityValue ?? value)
          ? { text: (accessibilityValue ?? value) as string }
          : undefined
      }
      accessibilityHint={listRowHint(description, accessibilityHint)}
      accessibilityState={{ disabled, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      onLongPress={onLongPress}
      // Offered only while the row takes presses: `disabled` doesn't reach a
      // custom action, so a busy row would otherwise take a second one.
      accessibilityActions={
        onLongPress && !disabled && !busy
          ? [{ name: "longpress", label: longPressLabel ?? "More actions" }]
          : undefined
      }
      onAccessibilityAction={
        onLongPress && !disabled && !busy
          ? (event) => {
              if (event.nativeEvent.actionName === "longpress") onLongPress();
            }
          : undefined
      }
      // `usePressFeedback`: a ripple on Android, bounded by the row because
      // `ListSection` clips its children, and a one-rung lift on iOS.
      android_ripple={disabled || busy ? undefined : feedback.ripple}
      style={({ pressed }) => feedback.lift(pressed)}
    >
      {content}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  // Shared so the caption's placeholder can't drift from the caption.
  const sectionHeaderMarginTop = tokens.spacing.sm;
  return StyleSheet.create({
    // The eyebrow web's section labels draw (`EYEBROW`), in the secondary tone.
    sectionHeader: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.mutedForeground,
      marginTop: sectionHeaderMarginTop,
    },
    // The caption and its count on one baseline. The caption keeps its own
    // top margin, so a counted header sits where an uncounted one does.
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: tokens.spacing.sm,
    },
    sectionHeaderCount: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      fontVariant: ["tabular-nums"],
    },
    // The caption's line box with its top margin; the uppercase tracking
    // doesn't change its height.
    sectionHeaderSkeleton: {
      marginTop: sectionHeaderMarginTop,
    },
    section: {
      // `card` at radius 14, the fill and radius web's grouped lists take
      // (`rounded-[14px] border bg-card`), and foundations §2's step for
      // "cards and list rows". It was `surface1` at 16 until 2026-11-05;
      // `surface1` is the nav and input step.
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      overflow: "hidden",
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.color.border.hairline,
      marginHorizontal: tokens.spacing.lg,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    rowText: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    // The detail row's value side: the rest of the row, its bar at the right.
    rowSkeletonValue: {
      flex: 1,
      alignItems: "flex-end",
    },
    rowLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    // A detail row sizes its label to its text and gives the rest of the row
    // to the value, the half that runs long (an email address). The label
    // stops at half the row and wraps there, so a long one (a chapter's
    // custom field has no length limit) never takes the row and leaves the
    // value no width. `flex: -1` is "my own width, shrinking if I must" on
    // both renderers; `flex: 0` is not, because react-native-web passes it
    // to CSS, where it means a zero basis and squeezes the label to a letter
    // a line.
    rowTextDetail: {
      flex: -1,
      maxWidth: "50%",
    },
    rowLabelDetail: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.regular,
      }),
      color: tokens.color.text.mutedForeground,
    },
    rowLabelDestructive: {
      color: tokens.color.semantic.destructive,
    },
    rowLabelDisabled: {
      color: tokens.color.text.disabled,
    },
    rowDescription: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    rowDescriptionDestructive: {
      color: tokens.color.semantic.destructive,
    },
    rowValue: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      flexShrink: 0,
    },
    rowValueDetail: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flex: 1,
      textAlign: "right",
    },
    chevron: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
      flexShrink: 0,
    },
    trailingSlot: {
      flexShrink: 0,
    },
  });
}

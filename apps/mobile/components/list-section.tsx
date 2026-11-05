import { ReactNode, useMemo } from "react";
import {
  Platform,
  Pressable,
  type PressableAndroidRippleConfig,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

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

export function SectionHeader({ children }: { children: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return <Text style={styles.sectionHeader}>{children}</Text>;
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
 * A list row's press feedback. The rule, and which rows follow it, is
 * `spec/ui/mobile/README.md` § Native-feel rules; this is only the mechanism.
 *
 * `ripple` goes to `android_ripple` (iOS ignores it). The ripple is bounded by
 * the row, so a row that wants its feedback to clear the text pads itself
 * rather than relying on a parent, and a rounded row clips it with
 * `overflow: "hidden"`. `lift(pressed)` goes into the `style` callback: on iOS
 * it raises the row one step up the surface ladder while it is held, and on
 * Android it returns nothing, since the ripple is already the signal.
 *
 * A row on the screen background or a grouped list lifts to `surface.card`.
 * A row that is itself a card (a task, the profile card) passes `onCard` and
 * lifts to `surface.popover` instead: a card lifted to its own colour shows
 * nothing.
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

export type ListRowProps = {
  label: string;
  /**
   * A leading glyph, drawn before the label. The More hub's rows carry one
   * (s09); the other grouped lists draw none.
   */
  leading?: ReactNode;
  /** Trailing static text — a value the member reads but cannot change here. */
  value?: string | null;
  /** A second line under the label. */
  description?: string | null;
  /** Trailing control (a switch, a swatch) instead of, or beside, `value`. */
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityHint?: string;
  /**
   * What a screen reader reads as the row's value when the trailing status is
   * a drawn element (a count badge, a chip) rather than `value` text. Defaults
   * to `value`.
   */
  accessibilityValue?: string;
  /** Renders the label in the destructive hue. Does not itself confirm anything. */
  destructive?: boolean;
  disabled?: boolean;
};

export function ListRow({
  label,
  leading,
  value,
  description,
  trailing,
  onPress,
  accessibilityHint,
  accessibilityValue,
  destructive = false,
  disabled = false,
}: ListRowProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const feedback = usePressFeedback();

  const content = (
    <View style={styles.row}>
      {leading}
      <View style={styles.rowText}>
        <Text
          style={[
            styles.rowLabel,
            destructive ? styles.rowLabelDestructive : null,
            disabled ? styles.rowLabelDisabled : null,
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text style={styles.rowDescription}>{description}</Text>
        ) : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {trailing}
      {onPress && !disabled ? <Text style={styles.chevron}>›</Text> : null}
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
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      // `usePressFeedback`: a ripple on Android, bounded by the row because
      // `ListSection` clips its children, and a one-rung lift on iOS.
      android_ripple={disabled ? undefined : feedback.ripple}
      style={({ pressed }) => feedback.lift(pressed)}
    >
      {content}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    sectionHeader: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginTop: tokens.spacing.sm,
    },
    section: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
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
    rowLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
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
    rowValue: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      flexShrink: 0,
    },
    chevron: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
      flexShrink: 0,
    },
  });
}

import { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The grouped-list chrome the reference draws on s12, s14, s15 and s16: an
 * uppercase section caption over a rounded container whose rows are separated
 * by inset hairlines.
 *
 * Shared because four screens draw it and `components/screen-shell.tsx` — which
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

export type ListRowProps = {
  label: string;
  /** Trailing static text — a value the member reads but cannot change here. */
  value?: string | null;
  /** A second line under the label. */
  description?: string | null;
  /** Trailing control (a switch, a swatch) instead of, or beside, `value`. */
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityHint?: string;
  /** Renders the label in the destructive hue. Does not itself confirm anything. */
  destructive?: boolean;
  disabled?: boolean;
};

export function ListRow({
  label,
  value,
  description,
  trailing,
  onPress,
  accessibilityHint,
  destructive = false,
  disabled = false,
}: ListRowProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const content = (
    <View style={styles.row}>
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

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
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
    pressed: {
      opacity: 0.7,
    },
  });
}

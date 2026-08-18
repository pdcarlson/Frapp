import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The chrome every Signet bottom sheet draws: the grabber, the title/Cancel
 * row, and the primary CTA — `spec/ui/design-system/components.md` § Bottom
 * sheet, drawn at `canvas-screens.dc.html` s19/s20/s21.
 *
 * Extracted because this is the third sheet in the app and the first two grew
 * byte-identical `grabber` / `sheetHeaderRow` / `sheetPrimaryButton` blocks.
 * That is the same duplication `components/state-block.tsx` was created to stop,
 * and the reason its header gives applies here: the copies drift, and the drift
 * is invisible until two sheets sit side by side.
 *
 * `app/(tabs)/service-hours.tsx` and `app/(tabs)/sheet-demo.tsx` still carry
 * their own copies — migrating them is a mechanical change with its own review
 * surface, tracked separately, exactly as #1050 tracks the state-block ones.
 *
 * This owns chrome only. The caller supplies the modal itself, because
 * `BottomSheetModal`'s ref, snap behavior and keyboard mode are per-sheet
 * decisions, and `handleComponent` is passed {@link SheetGrabber} directly.
 */

/** The drawn grabber, for `BottomSheetModal`'s `handleComponent`. */
export function SheetGrabber() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.grabberZone}>
      <View style={styles.grabber} />
    </View>
  );
}

export function SheetHeader({
  title,
  onCancel,
  cancelLabel = "Cancel",
}: {
  title: string;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View style={styles.headerRow}>
      <Text style={styles.title}>{title}</Text>
      {/* `hitSlop` meets the 44pt floor while keeping components.md §9's compact
          visual — the #939 ruling, as `service-hours.tsx` applies it. */}
      <Pressable
        accessibilityRole="button"
        onPress={onCancel}
        hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
      >
        <Text style={styles.cancel}>{cancelLabel}</Text>
      </Pressable>
    </View>
  );
}

export function SheetPrimaryButton({
  label,
  onPress,
  disabled = false,
  /** Painted with the chapter accent, whose fallback is the drawn house gold. */
  accent,
  onAccent,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accent: string;
  onAccent: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: accent },
        disabled ? styles.primaryButtonDisabled : null,
        pressed && !disabled ? styles.primaryButtonPressed : null,
      ]}
    >
      <Text style={[styles.primaryLabel, { color: onAccent }]}>{label}</Text>
    </Pressable>
  );
}

/** Shared background for `BottomSheetModal`'s `backgroundStyle`. */
export function useSheetBackgroundStyle() {
  const { tokens } = useFrappTheme();
  return createStyles(tokens).background;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    background: {
      backgroundColor: tokens.color.surface.popover,
      borderTopLeftRadius: tokens.radius.sheet,
      borderTopRightRadius: tokens.radius.sheet,
    },
    grabberZone: {
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.md,
      alignItems: "center",
    },
    grabber: {
      width: 40,
      height: 4.5,
      borderRadius: tokens.radius.chip,
      backgroundColor: tint(tokens.color.text.foreground, 0.18),
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: tokens.spacing.sm,
    },
    title: {
      // TODO-DESIGN: Canvas draws the sheet title at 19px/700; `title` is 18/600.
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    cancel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
    },
    primaryButton: {
      marginTop: tokens.spacing.sm,
      // 50px as drawn; the reference wins over components.md §9's 48px per
      // `spec/ui/README.md`'s precedence rule.
      height: 50,
      borderRadius: tokens.radius.control,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonDisabled: {
      opacity: 0.5,
    },
    primaryButtonPressed: {
      opacity: 0.85,
    },
    primaryLabel: {
      ...typeRole(tokens.typography.role.label),
    },
  });
}

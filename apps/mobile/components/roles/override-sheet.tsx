import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import type { Override } from "@repo/hooks/permission-overlay";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** The row the sheet is open on, and what the officer may pick there. */
export type OverrideTarget = {
  permission: string;
  label: string;
  roleName: string;
  tierName: string;
  /** The chapter's word for a tier, in running text. */
  tierWord: string;
  tierHas: boolean;
  current: Override;
  /** On is refused: the caller doesn't hold this permission. */
  onRefused: boolean;
  /** Same as tier is refused: it would grant what the caller lacks. */
  tierRefused: boolean;
  refusedReason: string;
};

type Option = {
  value: Override;
  label: string;
  description: string;
  refused: boolean;
};

/**
 * One permission on a role in a tier (#4072 on the phone, #4074): Same as
 * tier, On, or Off, the three answers web's Off / Same as tier / On control
 * gives, and Discord's per-role channel override (inherit, allow, deny).
 *
 * A row a tap away rather than a three-way control on every row: a role page
 * lists every permission, and a segment per row at phone width is thirty
 * controls where one answer in ten ever changes (Paul, 2026-11-06: keep
 * things a couple of taps away). The row already shows the answer and where
 * it comes from, so the state is never hidden. A pick saves and closes, like
 * Settings → Chat messages.
 */
export const OverrideSheet = forwardRef<
  BottomSheetModal,
  {
    target: OverrideTarget | null;
    onPick: (permission: string, value: Override) => void;
  }
>(function OverrideSheet({ target, onPick }, ref) {
  const closeSheet = useSheetClose(ref);
  const backgroundStyle = useSheetBackgroundStyle();
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);

  const options: Option[] = target
    ? [
        {
          value: null,
          label: `Same as ${target.tierWord}`,
          description: `${target.tierName} has it ${target.tierHas ? "on" : "off"}. Follows ${target.tierName} if that changes.`,
          refused: target.tierRefused,
        },
        {
          value: true,
          label: "On",
          description: `On for ${target.roleName}, whatever ${target.tierName} does.`,
          refused: target.onRefused,
        },
        {
          value: false,
          label: "Off",
          description: `Off for ${target.roleName}, whatever ${target.tierName} does.`,
          refused: false,
        },
      ]
    : [];

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView style={styles.body} onAccessibilityEscape={closeSheet}>
        {target ? (
          <>
            <SheetHeader title={target.label} />
            <Text style={styles.subtitle}>For {target.roleName}</Text>
            <View accessibilityRole="radiogroup">
              {options.map((option) => {
                const checked = option.value === target.current;
                const disabled = option.refused && !checked;
                return (
                  <Pressable
                    key={String(option.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked, disabled }}
                    accessibilityLabel={option.label}
                    accessibilityHint={
                      disabled ? target.refusedReason : option.description
                    }
                    disabled={disabled}
                    onPress={() => {
                      if (!checked) onPick(target.permission, option.value);
                      closeSheet();
                    }}
                    style={styles.option}
                  >
                    <View style={styles.text}>
                      <Text
                        style={[
                          styles.label,
                          checked ? styles.labelChecked : null,
                          disabled ? styles.labelDisabled : null,
                        ]}
                      >
                        {option.label}
                      </Text>
                      <Text style={styles.description}>
                        {disabled ? target.refusedReason : option.description}
                      </Text>
                    </View>
                    {checked ? <CheckGlyph color={brand.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    subtitle: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: 44,
      paddingVertical: tokens.spacing.sm,
    },
    text: { flex: 1, gap: tokens.spacing.xs },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    labelChecked: { color: brand.accent },
    labelDisabled: { color: tokens.color.text.muted },
    description: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}

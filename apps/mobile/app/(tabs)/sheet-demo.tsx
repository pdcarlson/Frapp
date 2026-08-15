// THROWAWAY (#937 S1) — Expo Go smoke vehicle only; delete before the Phase 2
// exit gate. Proves on a real device that: the app boots with the new provider
// stack, Figtree renders at every role/weight, the gorhom v5 sheet opens,
// drags, and dismisses with the §9 chrome, and the keyboard path falls back
// cleanly in Expo Go. Checklist: docs/internal/mobile/MOBILE_TESTING.md.
import { useCallback, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { useChapterBranding } from "@/lib/chapter-branding";
import { getKeyboardPath } from "@/lib/keyboard";
import {
  fontFamilyFor,
  MONO_FONT_FAMILY,
  tint,
  typeRole,
  useFrappTheme,
} from "@/lib/theme";

const TYPE_ROLES = [
  "display",
  "headline",
  "title",
  "body",
  "label",
  "caption",
] as const;

function Swatch({
  label,
  color,
  styles,
}: {
  label: string;
  color: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.swatchItem}>
      <View style={[styles.swatchChip, { backgroundColor: color }]} />
      <Text style={styles.swatchLabel}>{label}</Text>
    </View>
  );
}

export default function SheetDemoScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const sheetRef = useRef<BottomSheetModal>(null);

  const openSheet = useCallback(() => {
    sheetRef.current?.present();
  }, []);

  const closeSheet = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  return (
    <ScreenShell
      title="Sheet Demo"
      subtitle="Throwaway S1 smoke screen: fonts, tokens, keyboard path, and the gorhom v5 sheet."
    >
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Figtree specimen</Text>
        {TYPE_ROLES.map((role) => (
          <Text
            key={role}
            style={[
              typeRole(tokens.typography.role[role]),
              { color: tokens.color.text.foreground },
            ]}
          >
            {role} {tokens.typography.role[role].size}/
            {tokens.typography.role[role].weight}
          </Text>
        ))}
        <Text style={styles.monoSample}>mono · chapter-code 7F2-KQ</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Surface ladder + semantics</Text>
        <View style={styles.swatchRow}>
          <Swatch
            label="bg"
            color={tokens.color.surface.background}
            styles={styles}
          />
          <Swatch
            label="s1"
            color={tokens.color.surface.surface1}
            styles={styles}
          />
          <Swatch
            label="card"
            color={tokens.color.surface.card}
            styles={styles}
          />
          <Swatch
            label="pop"
            color={tokens.color.surface.popover}
            styles={styles}
          />
          <Swatch label="gold" color={tokens.color.gold.house} styles={styles} />
        </View>
        <View style={styles.swatchRow}>
          {(
            ["success", "warning", "destructive", "info", "mention"] as const
          ).map((hue) => (
            <Swatch
              key={hue}
              label={hue.slice(0, 4)}
              color={tint(tokens.color.semantic[hue], 0.35)}
              styles={styles}
            />
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Keyboard path</Text>
        <Text style={styles.keyboardPath}>
          {getKeyboardPath() === "native"
            ? "native — react-native-keyboard-controller is live"
            : "fallback — Expo Go path, KeyboardAvoidingView applies"}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={openSheet}
        style={styles.openButton}
      >
        <Text style={styles.openButtonText}>Open bottom sheet</Text>
      </Pressable>

      <BottomSheetModal
        ref={sheetRef}
        enableDynamicSizing
        keyboardBehavior="interactive"
        backgroundStyle={styles.sheetBackground}
        handleComponent={() => (
          <View style={styles.grabberZone}>
            <View style={styles.grabber} />
          </View>
        )}
      >
        <BottomSheetView style={styles.sheetBody}>
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>Demo sheet</Text>
            {/* hitSlop meets the ≥44px floor while keeping §9's compact visual
                (the #939 ruling pattern). */}
            <Pressable
              accessibilityRole="button"
              onPress={closeSheet}
              hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
            >
              <Text style={styles.sheetCancel}>Cancel</Text>
            </Pressable>
          </View>
          <Text style={styles.sheetBodyText}>
            Drag to dismiss, or type below — the field must ride the keyboard
            (interactive on the native path, avoiding-view on fallback).
          </Text>
          <BottomSheetTextInput
            placeholder="Type to test keyboard coordination"
            placeholderTextColor={tokens.color.text.muted}
            style={styles.sheetInput}
          />
          <Pressable
            accessibilityRole="button"
            onPress={closeSheet}
            style={styles.sheetPrimaryButton}
          >
            <Text style={styles.sheetPrimaryButtonText}>Done</Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheetModal>
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    sectionLabel: {
      ...typeRole(tokens.typography.role.label),
      textTransform: "uppercase",
      letterSpacing: 0.3,
      color: tokens.color.text.muted,
    },
    monoSample: {
      fontSize: tokens.typography.role.body.size,
      fontFamily: MONO_FONT_FAMILY,
      color: tokens.color.text.mutedForeground,
    },
    swatchRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    swatchItem: {
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    swatchChip: {
      width: 40,
      height: 28,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    swatchLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    keyboardPath: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    openButton: {
      borderRadius: tokens.radius.control,
      backgroundColor: accent,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    openButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.surface.background,
    },
    // Sheet chrome per components.md §9: elevated fill, top radius 20, square
    // bottom, hairline on top/sides only.
    sheetBackground: {
      backgroundColor: tokens.color.surface.popover,
      borderTopLeftRadius: tokens.radius.sheet,
      borderTopRightRadius: tokens.radius.sheet,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: tokens.color.border.hairline,
    },
    grabberZone: {
      alignItems: "center",
      paddingTop: 10,
      paddingBottom: 14,
    },
    grabber: {
      width: 40,
      height: 4.5,
      borderRadius: 4.5 / 2,
      backgroundColor: "rgba(255,255,255,0.18)",
    },
    sheetBody: {
      paddingHorizontal: 18,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    sheetHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    // 19/700 and 14.5 are the §9 sheet-header slot values, drawn in the
    // reference — component tables win over the §7 scale for component chrome.
    // No fontWeight next to a per-weight family (see typeRole's doc).
    sheetTitle: {
      fontSize: 19,
      fontFamily: fontFamilyFor(700),
      color: tokens.color.text.foreground,
    },
    sheetCancel: {
      fontSize: 14.5,
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.muted,
    },
    sheetBodyText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    sheetInput: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    sheetPrimaryButton: {
      borderRadius: tokens.radius.control,
      backgroundColor: accent,
      minHeight: tokens.touch.buttonLarge,
      alignItems: "center",
      justifyContent: "center",
    },
    sheetPrimaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.surface.background,
    },
  });
}

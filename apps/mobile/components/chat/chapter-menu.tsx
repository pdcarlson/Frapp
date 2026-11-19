import { useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { SignetTokens } from "@repo/theme/signet";
import type { AnchoredMenuState, MenuAnchor } from "@/components/anchored-menu";
import { useFocusOnOpen } from "@/lib/overlay";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The chapter menu: what Chat home's chapter name opens (Paul, 2026-11-19:
 * "can we move chapter settings into one place? the chapter thing on the top
 * left?"). Web's chapter row atop the nav opens the same menu
 * (`apps/web/components/layout/chapter-nav-header.tsx`), so on both the
 * chapter's name is the one door to its settings and to switching chapters,
 * the way Slack's workspace name and Discord's server name open theirs.
 *
 * Chapter settings leads, for a viewer it holds something for
 * (`chapterSettingsAccess`); Switch chapter opens the chapter picker, which
 * lists the member's chapters. Web lists those chapters in the menu itself and
 * adds Join another chapter; the phone joins by an invite link, so it has no
 * join step to offer here.
 *
 * Drawn by `ScreenShell`'s `overlay`, over the whole screen, like the channel
 * filter menu (`channel-filter-menu.tsx`): a tap outside, Android back and
 * VoiceOver's escape gesture close it.
 */

const MENU_WIDTH = 240;

export const CHAPTER_SETTINGS_LABEL = "Chapter settings";
export const SWITCH_CHAPTER_LABEL = "Switch chapter";

/** Under the title row, its left edge on the title's, never off screen. */
export function chapterMenuAnchor(
  tokens: SignetTokens,
  title: { x: number; y: number; width: number; height: number },
): MenuAnchor {
  return {
    top: title.y + title.height + tokens.spacing.xs,
    left: Math.max(tokens.spacing.sm, title.x),
  };
}

export function ChapterMenu({
  menu,
  showChapterSettings,
}: {
  menu: AnchoredMenuState;
  /** `chapterSettingsAccess(permissions).any`. */
  showChapterSettings: boolean;
}) {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const firstRef = useRef<View>(null);
  // Opening covers the title a screen reader was on, so move its focus here.
  useFocusOnOpen(firstRef, menu.visible);

  if (!menu.visible) return null;

  const rows: { key: string; label: string; hint: string; go: () => void }[] =
    [];
  if (showChapterSettings) {
    rows.push({
      key: "settings",
      label: CHAPTER_SETTINGS_LABEL,
      hint: "Opens the chapter's accent, chat background and roles.",
      go: () => router.push("/chapter-settings"),
    });
  }
  rows.push({
    key: "switch",
    label: SWITCH_CHAPTER_LABEL,
    hint: "Opens the list of chapters you belong to.",
    go: () =>
      // `from` is how the picker knows Chat is under it, and so draws
      // `‹ Chat` (`app/(auth)/chapter-picker.tsx`). Object form, the shape
      // `lib/routes.spec.ts` matches when a param is involved.
      router.push({
        pathname: "/(auth)/chapter-picker",
        params: { from: "chat" },
      }),
  });

  return (
    <View
      accessibilityViewIsModal
      onAccessibilityEscape={menu.close}
      style={styles.fill}
    >
      <Pressable
        testID="chapter-menu-backdrop"
        accessible={false}
        importantForAccessibility="no"
        onPress={menu.close}
        style={styles.fill}
      />
      <View
        style={[styles.menu, { top: menu.anchor.top, left: menu.anchor.left }]}
      >
        {rows.map((row, index) => (
          <Pressable
            key={row.key}
            ref={index === 0 ? firstRef : undefined}
            accessibilityRole="menuitem"
            accessibilityHint={row.hint}
            onPress={() => {
              menu.close();
              row.go();
            }}
            style={({ pressed }) => [
              styles.row,
              index > 0 ? styles.rowDivided : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.label}>{row.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    fill: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    menu: {
      position: "absolute",
      width: MENU_WIDTH,
      paddingHorizontal: tokens.spacing.md,
      backgroundColor: tokens.color.surface.popover,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      borderRadius: tokens.radius.control,
    },
    row: {
      justifyContent: "center",
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
    },
    rowDivided: {
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
    },
    pressed: { opacity: 0.6 },
    label: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
  });
}

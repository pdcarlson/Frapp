import { useMemo, useState } from "react";
import type { StyleProp, TextStyle } from "react-native";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import { signetDarkTokens, type SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

const LOGO_SIZE = 24;

/**
 * Header title for chapter-scoped screens: the chapter mark beside a label.
 *
 * The mark follows `spec/behavior/branding.md` § Chapter mark (#2876): the
 * logo, else a tile with the chapter's short name, else its Greek letters
 * unless it turned them off. With none of those the label stands alone. Unlike
 * the web nav's tile, which always fills its slot, this one never falls back
 * to initials: the chapter name renders right beside it, so initials would
 * only say the name twice. The label always renders, so the mark is purely
 * additive.
 *
 * `label` overrides the chapter name for a screen that needs to keep its own
 * title. Nothing passes it today: the Home tab it was written for is gone, and
 * Chat — the one screen that still mounts this — is now the home route and
 * deliberately shows the chapter crest and name rather than the word "Chat"
 * (`spec/ui/mobile/navigation.md`). Do not "restore" `label="Chat"`; that would
 * replace the chapter identity with a literal string.
 *
 * Mount this as an element -- `headerTitle: () => <ChapterHeaderTitle />` --
 * never as `headerTitle: ChapterHeaderTitle`. React Navigation *calls*
 * `headerTitle(...)` from inside its own Header render, and on Android that
 * call sits behind a `searchBarVisible` branch; passing the component
 * directly would attribute these hooks to Header and change its hook count
 * when that branch flips. The arrow returns an element, so the hooks below
 * get their own fiber.
 */
export function ChapterHeaderTitle({
  label,
  style,
}: {
  label?: string;
  /**
   * `headerTitleStyle` from screenOptions, forwarded by React Navigation.
   * It may carry an animated interpolation (the header cross-fade), which is
   * why the label below is an `Animated.Text` — the same node React
   * Navigation's own `HeaderTitle` renders.
   */
  style?: Animated.WithAnimatedValue<StyleProp<TextStyle>>;
}) {
  const { logoUrl, chapterName, textMark, accent } = useChapterBranding();
  const { tokens } = useFrappTheme();
  const markStyles = useMemo(() => createMarkStyles(tokens), [tokens]);
  // A logo that fails to load falls back to the text mark, not an empty slot.
  // Replacing a logo deletes the old object (#2592), so a member holding the
  // chapter read from before the replace has a signed URL to nothing until
  // the query refetches.
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const showLogo = !!logoUrl && logoUrl !== failedLogoUrl;

  const title = label ?? chapterName ?? "Frapp";

  return (
    <View style={styles.row}>
      {showLogo ? (
        <Image
          source={{ uri: logoUrl }}
          style={styles.logo}
          resizeMode="contain"
          onError={() => setFailedLogoUrl(logoUrl)}
          // The crest repeats the chapter name that renders next to it, so
          // announcing it again would just make screen readers say it twice.
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      ) : textMark ? (
        // Hidden from screen readers for the reason the logo is: the chapter
        // name beside it already says who this is.
        <View
          style={[markStyles.tile, { backgroundColor: accent }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="chapter-mark-text"
        >
          <Text
            style={[
              markStyles.text,
              textMark.length > 4 ? markStyles.textLong : null,
            ]}
            numberOfLines={1}
          >
            {textMark}
          </Text>
        </View>
      ) : null}
      <Animated.Text
        numberOfLines={1}
        // `style` last: a custom headerTitle bypasses the headerTitleStyle
        // that screenOptions applies to a plain string title, so without
        // forwarding it these two screens would silently stop tracking it.
        style={[styles.title, { color: tokens.color.text.foreground }, style]}
      >
        {title}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: 4,
  },
  // Static because this StyleSheet is module-scope; the Signet tokens are
  // fixed constants, so composing the role here is equivalent to the hook.
  title: {
    ...typeRole(signetDarkTokens.typography.role.title),
  },
});

/**
 * The text mark's tile: the logo's 24px footprint, filled with the chapter
 * accent under the fixed `gold.onHouse` label. That is the pairing mobile's
 * accent chips already use (`filter-chips.tsx`), and `useChapterBranding`
 * records its measurement: step 11 under `gold.onHouse` reads at 7.2:1 or
 * better for every colour the chapter directory seeds.
 */
function createMarkStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    tile: {
      minWidth: LOGO_SIZE,
      height: LOGO_SIZE,
      paddingHorizontal: 4,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
    },
    text: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
    textLong: {
      ...typeRole(tokens.typography.role.caption),
    },
  });
}

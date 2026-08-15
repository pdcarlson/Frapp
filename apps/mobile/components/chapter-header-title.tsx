import type { StyleProp, TextStyle } from "react-native";
import { Animated, Image, StyleSheet, View } from "react-native";
import { signetDarkTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

const LOGO_SIZE = 24;

/**
 * Header title for chapter-scoped screens: the chapter crest beside a label.
 *
 * Per `spec/behavior/branding.md`, a chapter with no logo falls back to text,
 * so the label always renders and the image is purely additive. `label`
 * overrides the chapter name for screens that need to keep their own title
 * (Chat stays "Chat"); Home leaves it unset and shows the chapter itself.
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
  const { logoUrl, chapterName } = useChapterBranding();
  const { tokens } = useFrappTheme();

  const title = label ?? chapterName ?? "Frapp";

  return (
    <View style={styles.row}>
      {logoUrl ? (
        <Image
          source={{ uri: logoUrl }}
          style={styles.logo}
          resizeMode="contain"
          // The crest repeats the chapter name that renders next to it, so
          // announcing it again would just make screen readers say it twice.
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
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

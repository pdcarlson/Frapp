import { Image, StyleSheet, Text, View } from "react-native";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useFrappTheme } from "@/lib/theme";

const LOGO_SIZE = 24;

/**
 * Header title for chapter-scoped screens: the chapter crest beside a label.
 *
 * Per `spec/behavior/branding.md`, a chapter with no logo falls back to text,
 * so the label always renders and the image is purely additive. `label`
 * overrides the chapter name for screens that need to keep their own title
 * (Chat stays "Chat"); Home leaves it unset and shows the chapter itself.
 */
export function ChapterHeaderTitle({ label }: { label?: string }) {
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
      <Text
        numberOfLines={1}
        style={[styles.title, { color: tokens.color.text.primary }]}
      >
        {title}
      </Text>
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
  title: {
    fontWeight: "700",
    fontSize: 17,
  },
});

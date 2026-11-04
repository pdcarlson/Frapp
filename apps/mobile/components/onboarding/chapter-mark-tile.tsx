import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * A chapter's mark before the member is inside it: chapter setup's preview
 * and live step (#3351), and the join confirm card (#3352). Chat home draws
 * its own (`components/chapter-mark.tsx`), because inside a chapter the mark
 * paints with the generated accent palette, which neither of these has yet.
 *
 * The logo when there is one, else `text` (the short name, the letters a
 * chapter shows, or initials; `spec/behavior/branding.md` § Chapter mark) on a
 * tint of `accent`. A tint rather than a fill, so any color keeps the text
 * readable. Callers pass text that has already been through
 * `resolveChapterMark` or `chapterTextMark`, never raw letters.
 */
export function ChapterMarkTile({
  logoUrl = null,
  text,
  accent,
  size,
  testID,
}: {
  logoUrl?: string | null;
  text: string;
  accent: string;
  size: number;
  testID?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // The URL that failed to load, so a new logo gets its own try.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const logoFailed = logoUrl !== null && failedUrl === logoUrl;
  const frame = {
    width: size,
    height: size,
    borderRadius: Math.round(size / 4),
  };
  if (logoUrl && !logoFailed) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        accessibilityLabel="Chapter logo"
        source={{ uri: logoUrl }}
        resizeMode="contain"
        onError={() => setFailedUrl(logoUrl)}
        style={[styles.logo, frame]}
      />
    );
  }
  return (
    <View
      testID={testID}
      style={[
        styles.tile,
        frame,
        { backgroundColor: tint(accent, 0.18), borderColor: accent },
      ]}
    >
      <Text
        style={[styles.text, { fontSize: Math.round(size * 0.3) }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {text}
      </Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    tile: {
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 4,
    },
    logo: {
      backgroundColor: tokens.color.surface.surface1,
    },
    text: {
      fontFamily: typeRole(tokens.typography.role.title).fontFamily,
      fontWeight: "700",
      color: tokens.color.text.foreground,
    },
  });
}

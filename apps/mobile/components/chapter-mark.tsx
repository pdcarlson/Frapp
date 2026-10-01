import { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

const LOGO_SIZE = 24;

/**
 * The chapter mark on Chat home's title row, beside the chapter name that
 * `ScreenShell` draws as the screen's title.
 *
 * The mark follows `spec/behavior/branding.md` § Chapter mark (#2876): the
 * logo, else a tile with the chapter's short name, else its Greek letters
 * unless it turned them off. With none of those it renders nothing and the
 * name stands alone. Unlike the web nav's tile, which always fills its slot,
 * this one never falls back to initials: the chapter name renders right beside
 * it, so initials would only say the name twice.
 *
 * Chat home is chat's home route, and it deliberately titles itself with the
 * chapter's crest and name rather than the word "Chat". This used to be the
 * tab navigator's header title; since #2485 no screen has that header, and the
 * mark moved onto the screen's own title row.
 */
export function ChapterMark() {
  const { logoUrl, textMark, accent } = useChapterBranding();
  const { tokens } = useFrappTheme();
  const markStyles = useMemo(() => createMarkStyles(tokens), [tokens]);
  // A logo that fails to load falls back to the text mark, not an empty slot.
  // Replacing a logo deletes the old object (#2592), so a member holding the
  // chapter read from before the replace has a signed URL to nothing until
  // the query refetches.
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const showLogo = !!logoUrl && logoUrl !== failedLogoUrl;

  if (showLogo) {
    return (
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
    );
  }

  if (!textMark) return null;

  return (
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
  );
}

const styles = StyleSheet.create({
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: 4,
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

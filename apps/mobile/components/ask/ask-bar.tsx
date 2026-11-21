import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { ASK_SEND_GLYPH } from "@repo/theme/crest";
import type { SignetTokens } from "@repo/theme/signet";
import { ASK_COPY } from "@repo/validation";
import { FrappCrest } from "@/components/frapp-crest";
import { GlassSurface } from "@/components/glass-surface";
import { useChapterBranding } from "@/lib/chapter-branding";
import { FLOATING_ASK_BAR } from "@/lib/floating-chrome";
import { selectionHaptic } from "@/lib/haptics";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Ask Frapp's front door on the phone (#4702): a glass bar above the tab bar
 * on the four tab screens, with the crest in the chapter's colour and the
 * field's own words, "Ask Frapp anything". From #4904 (Paul's pick of
 * 2026-11-13) until #5139 (Paul, 2026-11-16) it read "Search or ask Frapp",
 * when the field searched too; search is its own screen now, pushed from
 * Chat home.
 *
 * Paul, 2026-11-13: it should "show up with the logo", have "a little bit
 * more character" than the words alone, and sit "in a bar above the normal
 * liquid glass bottom, not only when you open the plus menu". It was a row
 * inside the + panel, which a member only saw after tapping +.
 *
 * It is drawn as the field it leads to: the placeholder a member will type
 * into, and that field's send arrow at its end, so the bar reads as "type here"
 * rather than as a banner. ChatGPT's and Perplexity's home screens and the
 * Google app all open their assistant from a bar shaped like its field. A
 * tap opens the conversation (`ask-sheet.tsx`) at full height; the bar holds
 * no text of its own.
 *
 * **The chapter's colour.** The crest, the capsule's edge and the
 * arrow take the accent (Paul, 2026-11-13, default 2 on #4698). Inside the
 * conversation what is the member's follows it and what is Frapp's, the
 * source markers, keeps Ask's fixed gold
 * (`spec/ui/design-system/components.md` §11).
 *
 * The tab bar draws it (`glass-tab-bar.tsx`), only for a member who has Ask.
 */
/** What the bar opens, for a screen reader. */
export const ASK_BAR_HINT = "Ask a question about your chapter";

export function AskBar({
  onPress,
  folded = false,
}: {
  onPress: () => void;
  /**
   * Folded into the tab bar's row while the member reads down a tab screen
   * (#4904): narrower, so the field's words keep the room and the arrow goes.
   */
  folded?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  return (
    <GlassSurface style={[styles.bar, { borderColor: tint(accent, 0.3) }]}>
      <Pressable
        testID="ask-bar"
        accessibilityRole="button"
        accessibilityLabel={ASK_COPY.name}
        accessibilityHint={ASK_BAR_HINT}
        onPress={() => {
          selectionHaptic();
          onPress();
        }}
        style={({ pressed }) => [styles.press, pressed && styles.pressed]}
      >
        <FrappCrest height={22} color={accent} />
        <Text style={styles.words} numberOfLines={1}>
          {ASK_COPY.placeholder}
        </Text>
        {folded ? null : (
          <View style={[styles.arrow, { backgroundColor: tint(accent) }]}>
            {/* The conversation's own send arrow (`ask-sheet.tsx`). */}
            <AskSendGlyph color={accent} size={16} />
          </View>
        )}
      </Pressable>
    </GlassSurface>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    bar: {
      // Fills its frame: the tab bar sizes it, 48pt open and the row's 62pt
      // folded (#4904), always fully round.
      flex: 1,
      minHeight: FLOATING_ASK_BAR.height,
      borderRadius: 999,
      borderWidth: 1,
    },
    press: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingLeft: tokens.spacing.lg,
      paddingRight: tokens.spacing.sm,
    },
    pressed: { backgroundColor: "rgba(255,255,255,0.08)" },
    words: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    arrow: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}

/**
 * The send arrow (`ASK_SEND_GLYPH`, shared with web's Ask bar since #5476),
 * transcribed from `canvas-screens.dc.html` s17 (the visual truth that wins
 * over prose per #937): on the bar's end and on the conversation's send
 * button, so the two are one mark. Colour arrives as a prop for the reason
 * `components/tab-glyphs.tsx` gives.
 */
export function AskSendGlyph({
  color,
  size = 17,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox={ASK_SEND_GLYPH.viewBox}>
      <Path
        d={ASK_SEND_GLYPH.path}
        stroke={color}
        strokeWidth={ASK_SEND_GLYPH.strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

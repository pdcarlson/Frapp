import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
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
 * field's own words, "Ask Frapp anything".
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
 * **The chapter's colour, here only.** The crest, the capsule's edge and the
 * arrow take the accent (Paul, 2026-11-13, default 2 on #4698). Inside the
 * conversation what is the member's follows it and what is Frapp's, the
 * source markers, keeps Ask's fixed gold
 * (`spec/ui/design-system/components.md` §11).
 *
 * The tab bar draws it (`glass-tab-bar.tsx`), only for a member who has Ask.
 */
export function AskBar({ onPress }: { onPress: () => void }) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  return (
    <GlassSurface style={[styles.bar, { borderColor: tint(accent, 0.3) }]}>
      <Pressable
        testID="ask-bar"
        accessibilityRole="button"
        accessibilityLabel={ASK_COPY.name}
        accessibilityHint={ASK_COPY.entry_label}
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
        <View style={[styles.arrow, { backgroundColor: tint(accent) }]}>
          {/* The conversation's own send arrow (`ask-sheet.tsx`). */}
          <Svg width={16} height={16} viewBox="0 0 17 17">
            <Path
              d="M2.5 8.5h9M8 3.5l6 5-6 5"
              stroke={accent}
              strokeWidth={1.9}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
      </Pressable>
    </GlassSurface>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    bar: {
      height: FLOATING_ASK_BAR.height,
      borderRadius: FLOATING_ASK_BAR.height / 2,
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

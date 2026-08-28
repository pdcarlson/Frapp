import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { SignetTokens } from "@repo/theme/signet";
import { SkeletonLines } from "@/components/state-block";
import type { AskAnswer, AskSource } from "@/lib/ask/corpus";
import { fontFamilyFor, tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The AI sourced-answer card — `spec/ui/design-system/components.md` §11, in
 * its **nested variant**: presented inside the s17 Ask sheet the block steps
 * down to card `#1E1B17` at radius 16, one ladder step below the sheet it sits
 * in, and the ✦ header moves up to the sheet header. Drawn at
 * `canvas-screens.dc.html` s17.
 *
 * **This surface never retints.** §11: "the answer surface speaks in Signet's
 * voice, not the chapter's." Nothing in this file may reach
 * `useChapterBranding()` — the border, the key figure and every source chip
 * come from the fixed `gold` token group, which exists for exactly this card.
 *
 * The card renders four states, because it has four to render: in flight,
 * answered, refused, and "I don't know". The last two are not error states and
 * must not look like them — a refusal is the product working correctly
 * (`spec/behavior/ai.md`: low confidence refuses rather than fabricates), so it
 * keeps the same gold chrome as an answer rather than borrowing `ErrorState`'s
 * semantic border.
 */

export function AnswerCard({
  answer,
  onOpenSource,
}: {
  /** `null` while the answer is in flight. */
  answer: AskAnswer | null;
  /** Fired when a citation chip is tapped. §11: chips are the citation UI. */
  onOpenSource: (source: AskSource) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  /*
   * In flight. §11 carries a TODO-DESIGN for this state — it is not drawn
   * anywhere — and names the content-shaped skeleton (§10) as the nearest
   * pattern, never a spinner-in-a-box.
   *
   * TODO-DESIGN: §11 asks for that skeleton *inside* the card chrome.
   * `SkeletonLines` brings its own card (radius, hairline, 16pt padding), so
   * nesting it would draw a card inside a card and double the padding to 32
   * inside a 16-padded sheet. Nearest pattern used: the skeleton stands in for
   * the whole card until the answer resolves.
   */
  if (answer === null) return <SkeletonLines lines={2} />;

  return (
    <View style={styles.card}>
      {answer.status === "answered" ? (
        <Text style={styles.answer}>
          {answer.spans.map((span, index) => (
            <Text
              key={index}
              style={
                span.emphasis === "key"
                  ? styles.keyFigure
                  : span.emphasis === "strong"
                    ? styles.strong
                    : null
              }
            >
              {span.text}
            </Text>
          ))}
        </Text>
      ) : (
        <Text style={styles.answer}>{answer.message}</Text>
      )}

      {answer.status === "answered" ? (
        <View style={styles.sourceRow}>
          {answer.sources.map((source) => (
            <SourceChip
              key={`${source.kind}:${source.label}`}
              source={source}
              onPress={() => onOpenSource(source)}
            />
          ))}
        </View>
      ) : null}

      <Text style={styles.footer}>
        Sources open in-app. Low confidence = refuses, never fabricates.
      </Text>
    </View>
  );
}

/**
 * One citation.
 *
 * §11 requires each chip to be tappable with a ≥ 44px hit area (§2) while
 * drawing it 28px tall. Expanded with `hitSlop` rather than by growing the box,
 * the #939 ruling `sheet-scaffold.tsx` and `ask-pill.tsx` already apply — the
 * drawing stays honest and the target stays legal.
 */
function SourceChip({
  source,
  onPress,
}: {
  source: AskSource;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Source: ${source.label}`}
      accessibilityHint="Open the source this answer quotes."
      // 28pt drawn against a 44pt minimum: 8pt a side closes the gap.
      // Vertical slop carries the 44pt floor (28 + 8 + 8); horizontal is capped
      // at half the row gap so neighbouring citations never share touch area.
      // See the same ruling on the suggestion chips in `ask-sheet.tsx`.
      hitSlop={{
        top: tokens.spacing.sm,
        bottom: tokens.spacing.sm,
        left: tokens.spacing.xs,
        right: tokens.spacing.xs,
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sourceChip,
        pressed ? styles.pressed : null,
      ]}
    >
      <SourceGlyph kind={source.kind} color={tokens.color.gold.askText} />
      <Text style={styles.sourceLabel}>{source.label}</Text>
    </Pressable>
  );
}

/**
 * The three leading source glyphs, transcribed from `canvas-screens.dc.html`
 * s17 — the visual truth that wins over prose per #937. Nothing here is
 * invented.
 *
 * Stroke-only rather than duotone, exactly as Canvas draws them:
 * `iconography.md` §1 reserves the duotone fill for a primary silhouette, and
 * inside a 28px chip a fill at 12px reads as a smudge. Colour arrives as a prop
 * for the reason `components/tab-glyphs.tsx` gives, even though this one caller
 * always passes `gold.askText`.
 */
function SourceGlyph({
  kind,
  color,
  size = 12,
}: {
  kind: AskSource["kind"];
  color: string;
  size?: number;
}) {
  const path =
    kind === "document"
      ? "M6 3.5h8l4 4V20a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 015 20V5A1.5 1.5 0 016.5 3.5z"
      : kind === "minutes"
        ? "M5 6.5h14M5 12h14M5 17.5h9"
        : "M4 6.5A3.5 3.5 0 017.5 3h9A3.5 3.5 0 0120 6.5v6a3.5 3.5 0 01-3.5 3.5H10l-4.5 4v-4A3.5 3.5 0 014 12.5z";

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={path}
        stroke={color}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      // House gold at 35%, per §11. `gold.house` is the fixed brand value; the
      // chapter accent is never allowed near this border.
      borderColor: tint(tokens.color.gold.house, 0.35),
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    answer: {
      // TODO-DESIGN: Canvas draws the answer at 16px/24; the `body` role is
      // 16/25 and arithmetic on a role token is a defect (foundations.md §7).
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    keyFigure: {
      // Weight only — size and line height are inherited from the parent Text,
      // so the emphasis cannot drift away from the sentence around it. The
      // family carries the weight because `fontWeight` alongside an
      // expo-font-registered family resolves the wrong typeface on Android
      // (`lib/theme.tsx`); `components/tab-glyphs.tsx` sets weight the same way.
      fontFamily: fontFamilyFor(700),
      color: tokens.color.gold.askText,
    },
    strong: {
      fontFamily: fontFamilyFor(700),
      color: tokens.color.text.foreground,
    },
    sourceRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      // TODO-DESIGN: Canvas draws the chip gap at 7; `spacing.sm` is 8 and is
      // the nearest step on the locked scale.
      gap: tokens.spacing.sm,
    },
    sourceChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs + 2,
      // Drawn geometry, as `ask-pill.tsx` (36) and `status-chip.tsx` (24)
      // already carry it. The 44pt floor is met by `hitSlop`, not by the box.
      height: 28,
      paddingHorizontal: tokens.spacing.sm,
      // TODO-DESIGN: Canvas draws radius 9; `chip` is 8 and is the nearest role
      // in the locked radius map (foundations.md § Radius).
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.gold.askBorder,
      backgroundColor: tokens.color.gold.askFill,
    },
    sourceLabel: {
      // TODO-DESIGN: Canvas draws the chip label at 12.5/600; `caption` is
      // 12.5/400, so the size is exact and only the weight is lifted.
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.gold.askText,
    },
    footer: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}

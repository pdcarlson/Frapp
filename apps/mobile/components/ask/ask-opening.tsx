import { useEffect, useMemo, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from "react-native-svg";
import type { SignetTokens } from "@repo/theme/signet";
import {
  ASK_COPY,
  ASK_STARTER,
  askDayLine,
  askGreeting,
  type AskSuggestion,
} from "@repo/validation";
import { AskQuestionBubble } from "@/components/ask/ask-turn";
import { FrappCrest } from "@/components/frapp-crest";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * What Ask opens on before the first turn (#4904; Paul, 2026-11-17: "a big
 * ... glowing logo and the chapter crest", and no paragraph about how Ask
 * works at the top "every single time"). From the top: the crest in the
 * chapter's colour over a glow of the same colour, the day and a greeting;
 * at the bottom, in thumb reach above the field, what this member could ask
 * right now as rows led by an arrow (Paul: "like kind of arrows"). Bevel's
 * assistant home and ChatGPT's and Claude's empty screens open the same way:
 * the mark and a greeting, no instructions.
 *
 * On a member's first open on this phone the explanation that used to sit at
 * the top every time is an exchange that has already happened instead
 * (`starter`): their "What can you do?" in their own bubble, and Frapp's
 * answer under it. It is our copy, not a model's, and it is never sent.
 *
 * With the keyboard up the crest steps down to 44pt beside the greeting at
 * the top, so the rows stay above the field. With nothing to suggest there
 * are no rows and nothing stands in (`spec/behavior/ai.md` § What Ask opens
 * with).
 */
export function AskOpening({
  displayName,
  starter,
  canAct,
  suggestions,
  onPick,
}: {
  displayName: string | null;
  /** This is the member's first open: draw the starter exchange. */
  starter: boolean;
  /** Frapp can take at least one action for this member. */
  canAct: boolean;
  suggestions: readonly AskSuggestion[];
  onPick: (suggestion: AskSuggestion) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const keyboardUp = useKeyboardUp();
  // Read once: a greeting that turned from afternoon to evening under the
  // member's eyes would be a strange thing to watch.
  const [now] = useState(() => new Date());
  const compact = keyboardUp && !starter;

  return (
    <View style={styles.root}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${ASK_COPY.name}. ${starter ? ASK_STARTER.hello(displayName) : askGreeting(now, displayName)}`}
        style={[
          styles.hero,
          compact ? styles.heroCompact : null,
          starter ? styles.heroStarter : null,
        ]}
      >
        <GlowingCrest height={compact ? 44 : starter ? 64 : 88} />
        <View style={compact ? styles.wordsCompact : styles.words}>
          {starter ? null : (
            <Text style={styles.day}>{askDayLine(now)}</Text>
          )}
          <Text
            style={[styles.greeting, compact ? styles.greetingCompact : null]}
          >
            {starter
              ? ASK_STARTER.hello(displayName)
              : askGreeting(now, displayName)}
          </Text>
        </View>
      </View>

      {starter ? (
        <View style={styles.starter}>
          <AskQuestionBubble text={ASK_STARTER.question} />
          <Text style={styles.answer}>{ASK_STARTER.answer}</Text>
          {canAct ? (
            <Text style={styles.answer}>{ASK_STARTER.answer_act}</Text>
          ) : null}
        </View>
      ) : null}

      {suggestions.length > 0 ? (
        // Fades in when it arrives, at the bottom where nothing sits below
        // it, so nothing above moves.
        <Animated.View
          entering={FadeIn.duration(SUGGESTIONS_FADE_MS)}
          style={styles.rows}
        >
          {(compact ? suggestions.slice(-2) : suggestions).map(
            (suggestion, index) => (
              <Pressable
                key={suggestion.text}
                accessibilityRole="button"
                accessibilityLabel={suggestion.text}
                accessibilityHint="Sends this."
                onPress={() => onPick(suggestion)}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 ? styles.rowRule : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <View style={styles.rowArrow}>
                  <ArrowGlyph color={tokens.color.text.muted} />
                </View>
                <Text style={styles.rowText}>{suggestion.text}</Text>
              </Pressable>
            ),
          )}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** An opacity change only, so it is the same with reduced motion on. */
const SUGGESTIONS_FADE_MS = 200;

/** The glow's reach past the crest's height, each way. */
const GLOW_SCALE = 3.2;

/**
 * The crest in the chapter's colour over a radial glow of the same colour,
 * which breathes (94% to 106%, 4.2s a cycle) while it is on screen. Drawn
 * with an SVG gradient, not a blur, so it is the same in Expo Go. Reduce
 * Motion holds it still. The crest is the accent, so a blue chapter glows
 * blue (`spec/ui/design-system/components.md` §11, the crest bullet).
 */
function GlowingCrest({ height }: { height: number }) {
  const { accent } = useChapterBranding();
  const reduceMotion = useReducedMotion();
  const breath = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      breath.set(0.5);
      return;
    }
    breath.set(
      withRepeat(
        withTiming(1, { duration: 2100, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
  }, [breath, reduceMotion]);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.7 + 0.3 * breath.get(),
    transform: [{ scale: 0.94 + 0.12 * breath.get() }],
  }));
  const glow = height * GLOW_SCALE;

  return (
    <View
      style={{ width: (height * 5) / 6, height }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: glow,
            height: glow,
            left: (height * 5) / 12 - glow / 2,
            top: height / 2 - glow / 2,
          },
          glowStyle,
        ]}
      >
        <Svg width={glow} height={glow}>
          <Defs>
            <RadialGradient id="ask-glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={accent} stopOpacity={0.55} />
              <Stop offset="0.42" stopColor={accent} stopOpacity={0.18} />
              <Stop offset="0.7" stopColor={accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={glow / 2} cy={glow / 2} r={glow / 2} fill="url(#ask-glow)" />
        </Svg>
      </Animated.View>
      <FrappCrest height={height} color={accent} />
    </View>
  );
}

/** The ↳ that leads a suggestion: "say this", as a reply would be. */
function ArrowGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M6 4v9a3 3 0 0 0 3 3h10M15 12l4 4-4 4"
        stroke={color}
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Whether the keyboard is on screen (iOS says so as it starts to move). */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(() => Keyboard.isVisible?.() ?? false);
  useEffect(() => {
    const subscriptions = [
      Keyboard.addListener("keyboardWillShow", () => setUp(true)),
      Keyboard.addListener("keyboardDidShow", () => setUp(true)),
      Keyboard.addListener("keyboardWillHide", () => setUp(false)),
      Keyboard.addListener("keyboardDidHide", () => setUp(false)),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return up;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    root: {
      // Fills the thread's room, so the rows sit at its bottom, above the
      // field, and the crest in the space above them.
      flex: 1,
      gap: tokens.spacing.xl,
    },
    hero: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.lg,
      minHeight: 220,
    },
    heroCompact: {
      // Sized by its contents: `flex: 0` collapses to nothing on web.
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: "auto",
      minHeight: 0,
      flexDirection: "row",
      justifyContent: "center",
      gap: tokens.spacing.md,
      paddingTop: tokens.spacing.lg,
    },
    heroStarter: {
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: "auto",
      minHeight: 0,
      paddingTop: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    words: {
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    wordsCompact: {
      gap: 2,
    },
    day: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    greeting: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
      textAlign: "center",
    },
    greetingCompact: {
      ...typeRole(tokens.typography.role.title),
      textAlign: "left",
    },
    starter: {
      flex: 1,
      gap: tokens.spacing.md,
    },
    answer: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    rows: {
      marginTop: "auto",
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.md,
      minHeight: 48,
      paddingVertical: tokens.spacing.md,
    },
    rowRule: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    rowArrow: {
      // Centres the 18pt glyph on the first 25pt line.
      paddingTop: 3,
    },
    rowText: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}

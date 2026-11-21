import { useEffect } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { formatTimer } from "@repo/formatting";
import type { SignetTokens } from "@repo/theme/signet";
import {
  CheckGlyph,
  CloseGlyph,
  MicGlyph,
  UndoGlyph,
} from "@/components/control-glyphs";
import {
  DICTATION_LEVEL_SAMPLES,
  useDictationLive,
  type DictationLive,
  type DictationNotice as Notice,
} from "@/lib/dictation/use-dictation";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Dictation's pieces, in Ask's composer (#5276; Paul's pick on 2026-11-17
 * from the design page, modelled on Bevel's assistant field, ChatGPT's
 * dictation and Wispr Flow) and every chat composer on the phone (#5772):
 *
 * - {@link DictationMic}: a mic inside the field's right end, so dictation can
 *   add to words already typed and send never moves.
 * - {@link DictationListening}: while listening the field becomes the voice's
 *   waveform in the chapter's colour, with cancel at its left and the elapsed
 *   time at its right; {@link DictationDone} takes send's place.
 * - {@link DictationHeard}: the words as the recogniser has them, faint above
 *   the field while the member talks, so they see it is working.
 * - {@link DictationTidying}: the heard words in the field, pulsing, while
 *   Frapp's AI tidies them.
 * - {@link DictationOriginal}: once tidied words land, a chip that puts back
 *   exactly what was said.
 * - {@link DictationNotice}: why a try ended short.
 *
 * The waveform, the clock and the words line read the live values themselves
 * (`useDictationLive`), so a level sample redraws them and nothing else.
 *
 * Phone only: web has no mic (#5276; for chat, Paul 2026-11-21). The words
 * are this file's own, not `ASK_COPY`'s, for that reason.
 */

export const DICTATION_COPY = {
  dictate: "Dictate",
  cancel: "Cancel dictation",
  done: "Done",
  listening: "Listening",
  tidying: "Tidying your words",
  original: "Original",
  originalHint: "Puts back exactly what you said",
  openSettings: "Open Settings",
  notice: {
    denied: "Frapp can't use the microphone or speech recognition.",
    "no-speech": "Didn't catch anything.",
    interrupted: "Dictation stopped.",
    unavailable: "Dictation isn't available right now.",
    failed: "Dictation stopped.",
    full: "That's all that fits in one question.",
    /** Chat's `full`: one go is capped by what the cleanup takes. */
    fullMessage: "That's all one dictation can hold.",
  } satisfies Record<Notice | "fullMessage", string>,
} as const;

/** 32pt inside a 44pt field; the slop reaches 44. */
const MIC_SIZE = 32;

export function DictationMic({ onPress }: { onPress: () => void }) {
  const { tokens } = useFrappTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={DICTATION_COPY.dictate}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.mic,
        pressed ? { backgroundColor: tokens.color.surface.card } : null,
      ]}
    >
      <MicGlyph color={tokens.color.text.mutedForeground} />
    </Pressable>
  );
}

export function DictationListening({
  live,
  onCancel,
  accent,
}: {
  live: DictationLive;
  onCancel: () => void;
  accent: string;
}) {
  const { levels, seconds } = useDictationLive(live);
  const { tokens } = useFrappTheme();
  const themed = createStyles(tokens);
  // The newest samples at the right, padded with silence at the left, so the
  // wave scrolls in from the right the way Voice Memos' does.
  const bars = [
    ...Array<number>(Math.max(0, DICTATION_LEVEL_SAMPLES - levels.length)).fill(
      0,
    ),
    ...levels,
  ];
  return (
    <View
      accessible
      accessibilityLabel={DICTATION_COPY.listening}
      accessibilityLiveRegion="polite"
      style={themed.listening}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={DICTATION_COPY.cancel}
        hitSlop={6}
        onPress={onCancel}
        style={themed.cancel}
      >
        <CloseGlyph color={tokens.color.text.mutedForeground} size={16} />
      </Pressable>
      <View style={styles.wave} importantForAccessibility="no-hide-descendants">
        {bars.map((level, index) => (
          <View
            // A bar is a slot in the wave, not an item: its index is its identity.
            key={index}
            style={[
              styles.bar,
              { backgroundColor: accent, height: 3 + Math.round(level * 21) },
            ]}
          />
        ))}
      </View>
      <Text style={themed.timer}>{formatTimer(seconds)}</Text>
    </View>
  );
}

export function DictationDone({
  onPress,
  fill,
  color,
}: {
  onPress: () => void;
  fill: string;
  color: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={DICTATION_COPY.done}
      hitSlop={2}
      onPress={onPress}
      style={({ pressed }) => [
        styles.done,
        { backgroundColor: fill },
        pressed ? styles.pressed : null,
      ]}
    >
      <CheckGlyph color={color} size={18} />
    </Pressable>
  );
}

/** The words so far, faint, above the field; the latest at the end. */
export function DictationHeard({ live }: { live: DictationLive }) {
  const { words } = useDictationLive(live);
  const { tokens } = useFrappTheme();
  if (!words) return null;
  return (
    <Text
      numberOfLines={2}
      ellipsizeMode="head"
      importantForAccessibility="no"
      style={[
        typeRole(tokens.typography.role.caption),
        {
          color: tokens.color.text.muted,
          paddingHorizontal: tokens.spacing.sm,
        },
      ]}
    >
      {words}
    </Text>
  );
}

/** The heard words in the field's place, pulsing while they are tidied. */
export function DictationTidying({ live }: { live: DictationLive }) {
  const { words } = useDictationLive(live);
  const { tokens } = useFrappTheme();
  const themed = createStyles(tokens);
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.set(
      withRepeat(
        withTiming(0.45, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);
  const faded = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <View
      accessible
      accessibilityLabel={DICTATION_COPY.tidying}
      accessibilityLiveRegion="polite"
      style={themed.tidying}
    >
      <Animated.View style={reduceMotion ? null : faded}>
        <Text
          numberOfLines={5}
          style={[
            themed.tidyingText,
            reduceMotion ? { color: tokens.color.text.muted } : null,
          ]}
        >
          {words}
        </Text>
      </Animated.View>
    </View>
  );
}

export function DictationOriginal({ onPress }: { onPress: () => void }) {
  const { tokens } = useFrappTheme();
  const themed = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={DICTATION_COPY.original}
      accessibilityHint={DICTATION_COPY.originalHint}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [themed.chip, pressed ? styles.pressed : null]}
    >
      <UndoGlyph color={tokens.color.text.mutedForeground} size={14} />
      <Text style={themed.chipText}>{DICTATION_COPY.original}</Text>
    </Pressable>
  );
}

export function DictationNotice({
  failure,
  onDismiss,
  fullText = DICTATION_COPY.notice.full,
}: {
  failure: Notice;
  onDismiss: () => void;
  /** What `full` says where the field isn't Ask's question. */
  fullText?: string;
}) {
  const { tokens } = useFrappTheme();
  const themed = createStyles(tokens);
  return (
    <View style={themed.notice} accessibilityLiveRegion="polite">
      <Text style={themed.noticeText}>
        {failure === "full" ? fullText : DICTATION_COPY.notice[failure]}
      </Text>
      {failure === "denied" ? (
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => {
            onDismiss();
            void Linking.openSettings().catch(() => undefined);
          }}
        >
          <Text style={themed.noticeAction}>{DICTATION_COPY.openSettings}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Dictated words after what is already in the field, cut to `max`. */
export function joinDictated(
  before: string,
  added: string,
  max: number,
): string {
  const head = before.trimEnd();
  const next = head ? `${head} ${added.trim()}` : added.trim();
  return next.slice(0, max);
}

const styles = StyleSheet.create({
  mic: {
    width: MIC_SIZE,
    height: MIC_SIZE,
    borderRadius: MIC_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  wave: {
    flex: 1,
    height: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
  },
  done: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    listening: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.button,
      paddingHorizontal: tokens.spacing.xs,
    },
    cancel: {
      width: MIC_SIZE,
      height: MIC_SIZE,
      borderRadius: MIC_SIZE / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tokens.color.surface.card,
    },
    timer: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      fontVariant: ["tabular-nums"],
      minWidth: 30,
      textAlign: "right",
      paddingRight: tokens.spacing.sm,
    },
    tidying: {
      flex: 1,
      minHeight: tokens.touch.button,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
    },
    tidyingText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      alignSelf: "flex-end",
      height: 28,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
    },
    chipText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    notice: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.sm,
    },
    noticeText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    noticeAction: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
      textDecorationLine: "underline",
    },
  });
}

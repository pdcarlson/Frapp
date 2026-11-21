import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import type { SignetTokens } from "@repo/theme/signet";
import {
  ASK_COPY,
  askStepChips,
  askStepFoundLine,
  askStepKinds,
  askStepLabel,
  askStepSpoken,
  askStepsSummary,
  type AskStepKind,
  type AskWorkStep,
} from "@repo/validation";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";
import { AskStepEndGlyph, AskStepGlyph } from "./ask-step-glyphs";

const TILE = 28;
const SMALL_TILE = 24;

function KindTile({
  kind,
  working = false,
  small = false,
}: {
  kind: AskStepKind;
  working?: boolean;
  small?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View
      style={[
        styles.tile,
        small ? styles.smallTile : null,
        working ? styles.workingTile : null,
      ]}
    >
      <AskStepGlyph
        kind={kind}
        size={small ? 13 : 15}
        color={
          working
            ? tokens.color.gold.askText
            : tokens.color.text.mutedForeground
        }
      />
    </View>
  );
}

/** The working mark: a ring that turns, or holds still half gold with Reduce Motion. */
function WorkingRing() {
  const { tokens } = useFrappTheme();
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    turn.set(
      withRepeat(
        withTiming(1, { duration: 900, easing: Easing.linear }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(turn);
  }, [turn, reduceMotion]);
  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get() * 360}deg` }],
  }));
  return (
    <Animated.View
      style={[
        {
          width: 15,
          height: 15,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: tokens.color.gold.askBorder,
          borderTopColor: tokens.color.gold.askText,
          ...(reduceMotion
            ? { borderRightColor: tokens.color.gold.askText }
            : {}),
        },
        spin,
      ]}
    />
  );
}

function StepRow({ step, last }: { step: AskWorkStep; last: boolean }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const reduceMotion = useReducedMotion();
  const line = askStepFoundLine(step);
  const chips = askStepChips(step);
  const quiet = step.state === "nothing" || step.state === "failed";
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(220)}
      style={[styles.row, last ? null : styles.rowGap]}
      accessible
      accessibilityLabel={askStepSpoken(step)}
    >
      {/* The rail that joins the icons, so the list reads as a path. */}
      {last ? null : <View style={styles.rail} />}
      <KindTile kind={step.kind} working={step.state === "working"} />
      <View style={styles.main}>
        <Text style={[styles.title, quiet ? styles.quietTitle : null]}>
          {askStepLabel(step)}
        </Text>
        {line ? <Text style={styles.found}>{line}</Text> : null}
        {chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((name) => (
              <View key={name} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.state}>
        {step.state === "working" ? (
          <WorkingRing />
        ) : (
          <AskStepEndGlyph
            state={step.state}
            color={
              step.state === "done"
                ? tokens.color.semantic.success
                : tokens.color.text.muted
            }
          />
        )}
      </View>
    </Animated.View>
  );
}

function StepList({ steps }: { steps: readonly AskWorkStep[] }) {
  return (
    <View>
      {steps.map((step, index) => (
        <StepRow key={step.key} step={step} last={index === steps.length - 1} />
      ))}
    </View>
  );
}

/**
 * Ask's working state as a short list of steps (#5427; web's `ask-steps.tsx`
 * draws the same, `spec/ui/design-system/components.md` §11). While Frapp
 * reads, each read is a row with its icon, a state and what it found. From
 * the answer's first word the list folds into one quiet row, which opens it
 * again.
 *
 * Nothing moves under the reader: the list only grows at its bottom, the end
 * of the thread, and it folds before there is anything under it to push.
 */
export function AskSteps({
  steps,
  folded,
}: {
  steps: readonly AskWorkStep[] | undefined;
  /** The answer has started, or the turn is over. */
  folded: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) return null;
  if (!folded) return <StepList steps={steps} />;
  const summary = askStepsSummary(steps);
  return (
    <View style={styles.folded}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint={open ? ASK_COPY.steps_hide : ASK_COPY.steps_show}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        hitSlop={4}
        style={({ pressed }) => [
          styles.summary,
          pressed ? styles.summaryPressed : null,
        ]}
      >
        <View style={styles.stack}>
          {askStepKinds(steps).map((kind, index) => (
            <View key={kind} style={index > 0 ? styles.stacked : null}>
              <KindTile kind={kind} small />
            </View>
          ))}
        </View>
        <Text style={styles.summaryText} numberOfLines={1}>
          {summary}
        </Text>
        <DisclosureGlyph
          direction={open ? "up" : "down"}
          color={tokens.color.text.muted}
          size={15}
        />
      </Pressable>
      {open ? <StepList steps={steps} /> : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    tile: {
      width: TILE,
      height: TILE,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      alignItems: "center",
      justifyContent: "center",
    },
    smallTile: {
      width: SMALL_TILE,
      height: SMALL_TILE,
      borderRadius: 7,
      // Each tile in the stack is cut out of the one under it.
      borderWidth: 2,
      borderColor: tokens.color.surface.background,
    },
    workingTile: {
      borderColor: tokens.color.gold.askBorder,
      backgroundColor: tokens.color.gold.askFill,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
    },
    rowGap: {
      paddingBottom: 10,
    },
    rail: {
      position: "absolute",
      left: TILE / 2 - 0.5,
      top: TILE + 2,
      bottom: 2,
      width: 1,
      backgroundColor: tokens.color.border.input,
    },
    main: {
      flex: 1,
      minWidth: 0,
      gap: 4,
      paddingTop: 4,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    quietTitle: {
      fontFamily: fontFamilyFor(400),
      color: tokens.color.text.muted,
    },
    found: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    chip: {
      height: 24,
      maxWidth: "100%",
      paddingHorizontal: 9,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      justifyContent: "center",
    },
    chipText: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.mutedForeground,
    },
    state: {
      paddingTop: 6,
    },
    folded: {
      gap: 10,
    },
    summary: {
      alignSelf: "flex-start",
      maxWidth: "100%",
      minHeight: tokens.touch.minimum,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingLeft: 6,
      paddingRight: 12,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
    },
    summaryPressed: {
      backgroundColor: tokens.color.surface.surface1,
    },
    stack: {
      flexDirection: "row",
    },
    stacked: {
      marginLeft: -6,
    },
    summaryText: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.mutedForeground,
      flexShrink: 1,
    },
  });
}

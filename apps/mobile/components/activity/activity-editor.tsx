import { useCallback, useEffect, useState } from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  ACTIVITY_CARD_COPY,
  ACTIVITY_WEEK_CARD_COPY,
  canHideActivityCard,
  hideActivityCard,
  moveActivityCard,
  moveActivityCardTo,
  showActivityCard,
  type ActivityCardArrangement,
  type ActivityCardRole,
} from "@repo/hooks";
import type { ActivityCardKey } from "@repo/validation";
import type { SignetTokens } from "@repo/theme/signet";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import {
  DragHandleGlyph,
  MinusGlyph,
  PlusGlyph,
} from "@/components/control-glyphs";
import { useDragRow } from "@/lib/drag-rows";
import { useChapterBranding } from "@/lib/chapter-branding";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Edit Activity (#5520; Paul's pick, 2026-11-18, after Bevel's Edit Home and
 * Apple Fitness's Edit Summary): the page's cards as a list, in place of the
 * page, until Done. Minus hides a card, plus brings it back, and the arrows
 * move it. This week stays first, as Fitness keeps its rings. Done saves the
 * arrangement to the member's account, so web shows the same page; Reset goes
 * back to the role's default. The rule is `spec/behavior/activity.md` § Cards.
 */
export function ActivityEditor({
  initial,
  role,
  saved,
  onDone,
  onReset,
}: {
  initial: ActivityCardArrangement;
  role: ActivityCardRole;
  /** Whether the member has an arrangement of their own to reset. */
  saved: boolean;
  onDone: (arrangement: ActivityCardArrangement) => void;
  onReset: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const [draft, setDraft] = useState(initial);
  // Android's back button is Done: the way out of a screen there, so it
  // keeps what the member changed, as Done and web's ‹ Activity do.
  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onDone(draft);
      return true;
    });
    return () => sub.remove();
  }, [draft, onDone]);

  // Dragging a card by its handle (#5520 step 2), as Bevel and Fitness
  // reorder theirs: the rows between slide apart to show where it lands.
  const heldIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const count = useSharedValue(draft.shown.length);
  useEffect(() => {
    count.set(draft.shown.length);
  }, [draft.shown.length, count]);
  const onDragStart = useCallback(() => undefined, []);
  const onDrop = useCallback(
    (from: number, rows: number) => {
      setDraft((current) => {
        const key = current.shown[from];
        return key ? moveActivityCardTo(current, key, from + rows) : current;
      });
      heldIndex.set(-1);
      dragY.set(0);
    },
    [heldIndex, dragY],
  );
  const drag = { heldIndex, dragY, count, onDragStart, onDrop };

  return (
    <View style={styles.body}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.title}>
          Edit Activity
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done"
          accessibilityHint="Saves your cards and goes back to Activity."
          onPress={() => onDone(draft)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.done,
            { backgroundColor: accent },
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>

      <Text style={styles.eyebrow}>Shown</Text>
      <View style={styles.list}>
        <View style={[styles.row, styles.noTop, styles.weekRow]}>
          <View style={styles.text}>
            <Text style={styles.name}>{ACTIVITY_WEEK_CARD_COPY.name}</Text>
            <Text style={styles.detail}>{ACTIVITY_WEEK_CARD_COPY.detail}</Text>
          </View>
        </View>
        {draft.shown.map((key, index) => (
          <ShownRow
            key={key}
            cardKey={key}
            index={index}
            isLast={index === draft.shown.length - 1}
            drag={drag}
            onHide={() => setDraft(hideActivityCard(draft, key))}
            onMove={(direction) =>
              setDraft(moveActivityCard(draft, key, direction))
            }
          />
        ))}
      </View>

      {draft.hidden.length > 0 ? (
        <>
          <Text style={styles.eyebrow}>Hidden</Text>
          <View style={styles.list}>
            {draft.hidden.map((key, index) => (
              <View key={key} style={[styles.row, index === 0 && styles.noTop]}>
                <RoundButton
                  label={`Show ${ACTIVITY_CARD_COPY[key].name}`}
                  tone="add"
                  onPress={() => setDraft(showActivityCard(draft, key, role))}
                />
                <CardText cardKey={key} />
              </View>
            ))}
          </View>
        </>
      ) : null}

      {saved ? (
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Puts your cards back in the order Frapp starts with."
          onPress={onReset}
          style={styles.reset}
        >
          <Text style={[styles.resetText, { color: accent }]}>
            Reset to the default
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The list's drag state, shared by its rows (`useDragRow`). */
type DragState = {
  heldIndex: SharedValue<number>;
  dragY: SharedValue<number>;
  count: SharedValue<number>;
  onDragStart: () => void;
  onDrop: (from: number, rows: number) => void;
};

/** Every shown row is one height, so a drag's distance is a count of rows. */
const ROW_HEIGHT = 64;

function ShownRow({
  cardKey,
  index,
  isLast,
  drag,
  onHide,
  onMove,
}: {
  cardKey: ActivityCardKey;
  index: number;
  isLast: boolean;
  drag: DragState;
  onHide: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const name = ACTIVITY_CARD_COPY[cardKey].name;
  const hideable = canHideActivityCard(cardKey);
  const { style: lifted, pan } = useDragRow({
    index,
    rowHeight: ROW_HEIGHT,
    liftedFill: tokens.color.surface.popover,
    ...drag,
  });
  return (
    <Animated.View
      style={[styles.row, styles.shownRow, lifted]}
      // A screen reader moves a row with these, since it can't drag.
      accessible
      accessibilityLabel={name}
      accessibilityActions={[
        ...(hideable ? [{ name: "hide", label: `Hide ${name}` }] : []),
        ...(index === 0 ? [] : [{ name: "up", label: "Move up" }]),
        ...(isLast ? [] : [{ name: "down", label: "Move down" }]),
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "hide" && hideable) onHide();
        if (event.nativeEvent.actionName === "up") onMove(-1);
        if (event.nativeEvent.actionName === "down") onMove(1);
      }}
    >
      {hideable ? (
        <RoundButton label={`Hide ${name}`} tone="remove" onPress={onHide} />
      ) : (
        // Holds the column, so every name lines up.
        <View style={styles.hit} />
      )}
      <CardText cardKey={cardKey} oneLine />
      {/* Drag from the handle only, so the rest of the list still scrolls. */}
      <GestureDetector gesture={pan}>
        <View
          style={styles.hit}
          hitSlop={8}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <DragHandleGlyph color={tokens.color.text.mutedForeground} />
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

function CardText({
  cardKey,
  oneLine = false,
}: {
  cardKey: ActivityCardKey;
  /** One line each, so a draggable row keeps the height a drag counts in. */
  oneLine?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const lines = oneLine ? 1 : undefined;
  return (
    <View style={styles.text}>
      <Text numberOfLines={lines} style={styles.name}>
        {ACTIVITY_CARD_COPY[cardKey].name}
      </Text>
      <Text numberOfLines={lines} style={styles.detail}>
        {ACTIVITY_CARD_COPY[cardKey].detail}
      </Text>
    </View>
  );
}

function RoundButton({
  label,
  tone,
  onPress,
}: {
  label: string;
  tone: "add" | "remove";
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const fill =
    tone === "add"
      ? tokens.color.semantic.success
      : tokens.color.semantic.destructive;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
    >
      <View style={[styles.round, { backgroundColor: fill }]}>
        {tone === "add" ? (
          <PlusGlyph color={tokens.color.semantic.onSemantic} size={14} />
        ) : (
          <MinusGlyph color={tokens.color.semantic.onSemantic} size={14} />
        )}
      </View>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    body: { gap: tokens.spacing.sm },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: tokens.touch.minimum,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    done: {
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.lg,
      borderRadius: tokens.radius.control,
      justifyContent: "center",
    },
    doneText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
    eyebrow: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      textTransform: "uppercase",
      letterSpacing: 1.2,
      marginTop: tokens.spacing.md,
    },
    list: {
      backgroundColor: surfaces.card,
      borderRadius: tokens.radius.cardLarge,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      minHeight: 60,
      paddingHorizontal: tokens.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    noTop: { borderTopWidth: 0 },
    shownRow: { height: ROW_HEIGHT, minHeight: ROW_HEIGHT },
    weekRow: { paddingLeft: tokens.spacing.lg },
    text: { flex: 1, paddingVertical: tokens.spacing.sm },
    name: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    detail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    hit: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    round: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    reset: {
      alignSelf: "center",
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      marginTop: tokens.spacing.sm,
    },
    resetText: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.semibold,
      }),
    },
    pressed: { opacity: 0.6 },
  });
}

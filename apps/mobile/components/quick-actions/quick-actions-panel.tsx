import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Path } from "react-native-svg";
import { NAV_GLYPHS, type DuotoneGlyphPaths } from "@repo/theme/nav-glyphs";
import { SignetTokens } from "@repo/theme/signet";
import { ASK_COPY } from "@repo/validation";
import { GlassSurface } from "@/components/glass-surface";
import { NavGlyph } from "@/components/nav-glyph";
import { selectionHaptic } from "@/lib/haptics";
import {
  addableQuickActions,
  addQuickAction,
  moveQuickAction,
  QUICK_ACTION_HINTS,
  QUICK_ACTION_LABELS,
  QUICK_ACTION_LIMIT,
  quickActionColumns,
  type QuickActionKey,
  removeQuickAction,
} from "@/lib/quick-actions";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";

/** Each action's glyph: the nav-set shape of the place it leads. */
const GLYPHS: Record<QuickActionKey, DuotoneGlyphPaths> = {
  newEvent: NAV_GLYPHS.events,
  newTask: NAV_GLYPHS.tasks,
  invite: NAV_GLYPHS.invite,
  message: NAV_GLYPHS.chat,
  checkIn: NAV_GLYPHS.checkIn,
  hostCheckIn: NAV_GLYPHS.hostCheckIn,
  logHours: NAV_GLYPHS.service,
  study: NAV_GLYPHS.study,
  upload: NAV_GLYPHS.documents,
};

/** The round tile each action sits on. */
export const QUICK_ACTION_DISC = 58;
const GLYPH_SIZE = 26;
/** Disc, the 8pt gap and the 13pt label's line. */
const CELL_HEIGHT = QUICK_ACTION_DISC + 8 + 18;
const ROW_GAP = 16;
const ROW_PITCH = CELL_HEIGHT + ROW_GAP;
/** The panel's inner padding. */
const PAD_X = 10;
const PAD_Y = 18;
/** Edit mode lays out in threes, whatever the count. */
const EDIT_COLUMNS = 3;

export type QuickActionsPanelProps = {
  shown: readonly QuickActionKey[];
  available: readonly QuickActionKey[];
  /** The panel's drawn width, for the edit grid's slots. */
  width: number;
  editing: boolean;
  /**
   * Whether a hold may start editing. Off while the member's role is still
   * loading (`useQuickActions().ready`).
   */
  canEdit?: boolean;
  onEditingChange: (editing: boolean) => void;
  onRun: (key: QuickActionKey) => void;
  onSave: (keys: readonly QuickActionKey[]) => void;
  /**
   * Opens Ask Frapp. Passed only for a member who has Ask
   * (`useAiSurfaces().ask`); without it the panel is exactly as it was.
   */
  onAsk?: () => void;
};

/**
 * The glass panel the tab bar's + opens (`spec/ui/mobile/navigation.md` §
 * Quick actions): round actions in rows, sized like the board's touch targets.
 *
 * Press and hold anywhere on it to edit in place: the actions jiggle, each
 * takes a minus, a drag moves one, and the Add row below holds what the member
 * can use but hasn't placed. Every change is kept as it is made, so Done and
 * closing the panel both leave it as the member left it.
 *
 * Ask Frapp is a bar across the top, above the actions, for a member who has
 * it (`navigation.md` § Global entries). It is not one of the actions a
 * member places: it can't be removed or moved, so it is where they left it on
 * every tab, and it steps aside while the actions are being edited.
 */
export function QuickActionsPanel({
  shown,
  available,
  width,
  editing,
  canEdit = true,
  onEditingChange,
  onRun,
  onSave,
  onAsk,
}: QuickActionsPanelProps) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const enterEditing = () => {
    if (editing || !canEdit) return;
    selectionHaptic();
    onEditingChange(true);
  };

  const cols = editing ? EDIT_COLUMNS : quickActionColumns(shown.length);
  const cellWidth = Math.max((width - PAD_X * 2) / cols, 1);

  return (
    <GlassSurface style={[styles.panel, { width }]}>
      <Pressable
        // Holding the panel's own surface, between the actions, edits too.
        onLongPress={enterEditing}
        delayLongPress={LONG_PRESS_MS}
        accessible={false}
        style={styles.body}
      >
        {onAsk && !editing ? <AskBar onPress={onAsk} styles={styles} /> : null}
        {editing ? (
          <EditGrid
            shown={shown}
            available={available}
            cellWidth={cellWidth}
            onDone={() => onEditingChange(false)}
            onSave={onSave}
            styles={styles}
          />
        ) : shown.length === 0 ? (
          <Text style={styles.empty}>Press and hold here to add actions.</Text>
        ) : (
          <View style={styles.rows}>
            {shown.map((key) => (
              <ActionButton
                key={key}
                actionKey={key}
                width={cellWidth}
                onRun={onRun}
                onEdit={canEdit ? enterEditing : undefined}
                styles={styles}
              />
            ))}
          </View>
        )}
      </Pressable>
    </GlassSurface>
  );
}

const LONG_PRESS_MS = 400;

/**
 * The Ask Frapp entry: Ask's fixed gold, never the chapter accent
 * (`spec/ui/design-system/components.md` §11).
 */
function AskBar({ onPress, styles }: { onPress: () => void; styles: Styles }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ASK_COPY.name}
      accessibilityHint={ASK_COPY.entry_label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.askBar,
        pressed ? styles.askBarPressed : null,
      ]}
    >
      <Text style={styles.askName}>{ASK_COPY.name}</Text>
      <Text style={styles.askHint} numberOfLines={1}>
        {ASK_COPY.placeholder}
      </Text>
    </Pressable>
  );
}

/** One action at rest: a tap runs it, a hold starts editing. */
function ActionButton({
  actionKey,
  width,
  onRun,
  onEdit,
  styles,
}: {
  actionKey: QuickActionKey;
  width: number;
  onRun: (key: QuickActionKey) => void;
  onEdit?: () => void;
  styles: Styles;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={QUICK_ACTION_LABELS[actionKey]}
      accessibilityHint={QUICK_ACTION_HINTS[actionKey]}
      // A screen reader's hold, as a named action, so editing is in reach
      // without the gesture.
      accessibilityActions={
        onEdit ? [{ name: "longpress", label: "Edit quick actions" }] : []
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "longpress") onEdit?.();
      }}
      onPress={() => onRun(actionKey)}
      onLongPress={onEdit}
      delayLongPress={LONG_PRESS_MS}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.cell, { width }]}
    >
      <ActionFace actionKey={actionKey} pressed={pressed} styles={styles} />
    </Pressable>
  );
}

function ActionFace({
  actionKey,
  pressed = false,
  dimmed = false,
  badge,
  onBadge,
  styles,
}: {
  actionKey: QuickActionKey;
  pressed?: boolean;
  dimmed?: boolean;
  badge?: "remove" | "add";
  onBadge?: () => void;
  styles: Styles;
}) {
  const { tokens } = useFrappTheme();
  return (
    <View style={[styles.face, dimmed && styles.dimmed]}>
      <View style={[styles.disc, pressed && styles.discPressed]}>
        <NavGlyph
          paths={GLYPHS[actionKey]}
          color={tokens.color.text.foreground}
          size={GLYPH_SIZE}
        />
        {badge === "remove" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${QUICK_ACTION_LABELS[actionKey]}`}
            hitSlop={10}
            onPress={onBadge}
            style={[styles.badge, styles.badgeRemove]}
          >
            <BadgeGlyph kind="remove" />
          </Pressable>
        ) : badge === "add" ? (
          <View style={[styles.badge, styles.badgeAdd]}>
            <BadgeGlyph kind="add" />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.label}>
        {QUICK_ACTION_LABELS[actionKey]}
      </Text>
    </View>
  );
}

function BadgeGlyph({ kind }: { kind: "remove" | "add" }) {
  return (
    <Svg width={10} height={10} viewBox="0 0 10 10">
      <Path
        d={kind === "remove" ? "M2 5h6" : "M5 2v6M2 5h6"}
        stroke="#FFFFFF"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** The slot's top-left in the edit grid. */
function slot(index: number, cellWidth: number) {
  return {
    x: (index % EDIT_COLUMNS) * cellWidth,
    y: Math.floor(index / EDIT_COLUMNS) * ROW_PITCH,
  };
}

function EditGrid({
  shown,
  available,
  cellWidth,
  onDone,
  onSave,
  styles,
}: {
  shown: readonly QuickActionKey[];
  available: readonly QuickActionKey[];
  cellWidth: number;
  onDone: () => void;
  onSave: (keys: readonly QuickActionKey[]) => void;
  styles: Styles;
}) {
  // The order while a drag runs, saved when the finger lifts; between drags
  // the panel shows what is saved. The shared value is what the gesture
  // reads, so each hover moves from where the action is now.
  const [dragOrder, setDragOrder] = useState<QuickActionKey[] | null>(null);
  const live = useSharedValue<QuickActionKey[] | null>(null);
  const order: readonly QuickActionKey[] = dragOrder ?? shown;

  const active = useSharedValue<string | null>(null);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  const addable = addableQuickActions(order, available);
  const full = order.length >= QUICK_ACTION_LIMIT;
  const rows = Math.max(1, Math.ceil(order.length / EDIT_COLUMNS));

  return (
    <View>
      <View style={styles.editHead}>
        <Text style={styles.editHint}>
          {order.length > 1 ? "Drag to move" : "Add actions below"} ·{" "}
          {order.length} of {QUICK_ACTION_LIMIT}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done editing"
          onPress={onDone}
          hitSlop={8}
          style={({ pressed }) => [styles.done, pressed && styles.donePressed]}
        >
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>

      <View style={{ height: rows * ROW_PITCH - ROW_GAP }}>
        {order.map((key, index) => (
          <DraggableAction
            key={key}
            actionKey={key}
            index={index}
            count={order.length}
            cellWidth={cellWidth}
            active={active}
            dragX={dragX}
            dragY={dragY}
            onHover={(to) => {
              const current = live.get() ?? [...shown];
              const from = current.indexOf(key);
              if (from === to) return;
              const next = moveQuickAction(current, from, to);
              live.set(next);
              setDragOrder(next);
            }}
            onDrop={() => {
              const final = live.get();
              live.set(null);
              setDragOrder(null);
              if (final) onSave(final);
            }}
            onRemove={() => onSave(removeQuickAction(order, key))}
            onMove={(to) => onSave(moveQuickAction(order, index, to))}
            styles={styles}
          />
        ))}
      </View>

      {addable.length > 0 ? (
        <>
          <Text style={styles.addHead}>
            {full ? "Remove one to add" : "Add"}
          </Text>
          <View style={styles.rows}>
            {addable.map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`Add ${QUICK_ACTION_LABELS[key]}`}
                accessibilityState={{ disabled: full }}
                disabled={full}
                onPress={() => onSave(addQuickAction(order, key))}
                style={[styles.cell, { width: cellWidth }]}
              >
                <ActionFace
                  actionKey={key}
                  dimmed
                  badge={full ? undefined : "add"}
                  styles={styles}
                />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function DraggableAction({
  actionKey,
  index,
  count,
  cellWidth,
  active,
  dragX,
  dragY,
  onHover,
  onDrop,
  onRemove,
  onMove,
  styles,
}: {
  actionKey: QuickActionKey;
  index: number;
  count: number;
  cellWidth: number;
  active: SharedValue<string | null>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  onHover: (to: number) => void;
  onDrop: () => void;
  onRemove: () => void;
  /** A screen reader's move, one place at a time. */
  onMove: (to: number) => void;
  styles: Styles;
}) {
  const reduceMotion = useReducedMotion();
  const home = slot(index, cellWidth);

  // The jiggle that says "editing", out of step with its neighbours. None
  // with Reduce Motion on.
  const tilt = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      tilt.set(0);
      return;
    }
    tilt.set(index % 2 === 0 ? -1.6 : 1.6);
    tilt.set(
      withRepeat(
        withTiming(index % 2 === 0 ? 1.6 : -1.6, { duration: 150 }),
        -1,
        true,
      ),
    );
  }, [reduceMotion, index, tilt]);

  // Where the drag began. The slot under the finger moves as the others
  // close up around it, so the finger's offset is measured from here.
  const startX = useSharedValue(home.x);
  const startY = useSharedValue(home.y);

  // JS-thread callbacks: the grid is six cells, and a reorder is React state.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(4)
    .onStart(() => {
      selectionHaptic();
      startX.set(home.x);
      startY.set(home.y);
      active.set(actionKey);
      dragX.set(home.x);
      dragY.set(home.y);
    })
    .onUpdate((event: { translationX: number; translationY: number }) => {
      const x = startX.get() + event.translationX;
      const y = startY.get() + event.translationY;
      dragX.set(x);
      dragY.set(y);
      const col = Math.max(
        0,
        Math.min(EDIT_COLUMNS - 1, Math.floor((x + cellWidth / 2) / cellWidth)),
      );
      const row = Math.max(0, Math.floor((y + CELL_HEIGHT / 2) / ROW_PITCH));
      onHover(Math.min(count - 1, row * EDIT_COLUMNS + col));
    })
    .onFinalize(() => {
      if (active.get() !== actionKey) return;
      active.set(null);
      onDrop();
    });

  const motion = useAnimatedStyle(() => {
    const dragging = active.get() === actionKey;
    const duration = reduceMotion ? 0 : 180;
    return {
      zIndex: dragging ? 2 : 1,
      transform: [
        {
          translateX: dragging ? dragX.get() : withTiming(home.x, { duration }),
        },
        {
          translateY: dragging ? dragY.get() : withTiming(home.y, { duration }),
        },
        { scale: dragging ? 1.08 : 1 },
        { rotate: `${dragging ? 0 : tilt.get()}deg` },
      ],
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessible
        accessibilityLabel={QUICK_ACTION_LABELS[actionKey]}
        accessibilityHint="Drag to move it."
        // The view is one element to a screen reader, so the minus badge
        // inside it can't take focus: remove and move are its actions.
        accessibilityActions={[
          { name: "remove", label: "Remove" },
          ...(index > 0
            ? [{ name: "moveEarlier", label: "Move earlier" }]
            : []),
          ...(index < count - 1
            ? [{ name: "moveLater", label: "Move later" }]
            : []),
        ]}
        onAccessibilityAction={(event) => {
          const action = event.nativeEvent.actionName;
          if (action === "remove") onRemove();
          if (action === "moveEarlier") onMove(index - 1);
          if (action === "moveLater") onMove(index + 1);
        }}
        style={[styles.slot, { width: cellWidth }, motion]}
      >
        <ActionFace
          actionKey={actionKey}
          badge="remove"
          onBadge={onRemove}
          styles={styles}
        />
      </Animated.View>
    </GestureDetector>
  );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    panel: { borderRadius: 30 },
    body: { paddingHorizontal: PAD_X, paddingVertical: PAD_Y },
    rows: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      rowGap: ROW_GAP,
    },
    cell: { alignItems: "center", height: CELL_HEIGHT },
    slot: {
      position: "absolute",
      left: 0,
      top: 0,
      height: CELL_HEIGHT,
      alignItems: "center",
    },
    face: { alignItems: "center", gap: 8 },
    dimmed: { opacity: 0.5 },
    disc: {
      width: QUICK_ACTION_DISC,
      height: QUICK_ACTION_DISC,
      borderRadius: QUICK_ACTION_DISC / 2,
      alignItems: "center",
      justifyContent: "center",
      // A step of white over the glass, as the board draws a raised control
      // on chrome: no fill of its own, so the glass reads through.
      backgroundColor: "rgba(255,255,255,0.07)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.08)",
    },
    discPressed: { backgroundColor: "rgba(255,255,255,0.14)" },
    label: {
      ...typeRole(tokens.typography.role.caption),
      fontSize: 13,
      lineHeight: 18,
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
      maxWidth: 104,
    },
    badge: {
      position: "absolute",
      top: -3,
      left: -3,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: tokens.color.surface.surface1,
    },
    badgeRemove: { backgroundColor: "#5A5A5A" },
    badgeAdd: { backgroundColor: tokens.color.semantic.success },
    editHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: 8,
      marginBottom: 14,
    },
    editHint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    done: {
      height: 32,
      paddingHorizontal: 14,
      borderRadius: 16,
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.10)",
    },
    donePressed: { backgroundColor: "rgba(255,255,255,0.18)" },
    doneText: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    addHead: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
      marginTop: 18,
      marginBottom: 12,
      marginHorizontal: 8,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    askBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      height: tokens.touch.button,
      marginHorizontal: 8,
      marginBottom: ROW_GAP,
      paddingHorizontal: tokens.spacing.lg,
      borderRadius: tokens.touch.button / 2,
      borderWidth: 1,
      borderColor: tokens.color.gold.askBorder,
      backgroundColor: tokens.color.gold.askFill,
    },
    askBarPressed: { opacity: 0.7 },
    askName: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(700),
      color: tokens.color.gold.askText,
    },
    askHint: {
      flex: 1,
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    empty: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
      paddingVertical: 24,
    },
  });
}

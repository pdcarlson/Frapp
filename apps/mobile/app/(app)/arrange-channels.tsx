import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import {
  useCategories,
  useChannels,
  usePermissionList,
  useReorderCategories,
  useReorderChannels,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_CHAT } from "@/components/back-row";
import { InlineNote } from "@/components/inline-note";
import { DisclosureGlyph, DragHandleGlyph } from "@/components/control-glyphs";
import { ICON_BUTTON_SIZE, IconButton } from "@/components/icon-button";
import { pressHaptic, selectionHaptic } from "@/lib/haptics";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { selectCategories, selectChannels } from "@/lib/chat/channel-list";
import {
  arrangeEntries,
  categoryMovedAnnouncement,
  dropIndex,
  moveCategory,
  moveChannelEntry,
  movedAnnouncement,
  type ArrangeEntry,
} from "@/lib/chat/arrange-channels";

/** Every row and heading is one height, so a drag's distance is a count of rows. */
const ROW_HEIGHT = 48;
const SHIFT_MS = 150;

/**
 * Arrange channels, on the phone (#3838; Shawn wanted drag to reorder on the
 * phone as well as web). Opened from a channel's long-press menu by an
 * officer with `channels:manage`. Each channel row has a handle at its right
 * edge; dragging it moves the row, the rows between slide apart to show where
 * it will land, and letting go saves the section it landed in at once,
 * through the same `PUT /v1/channels/order` web's rail uses. Dragging past a
 * heading files the channel under that category. A drag is from the handle
 * only, so the rest of the screen still scrolls, and a screen reader moves a
 * row with its Move up and Move down actions.
 *
 * A category moves whole with the Move up and Move down arrows on its heading
 * (#4478), saved at once through web's `PUT /v1/channels/categories/order`.
 * Arrows rather than a second drag: a heading drag would have to carry every
 * row under it, and a chapter's handful of categories moves in a tap or two,
 * as iOS Mail's mailbox list and Slack's sidebar sections move theirs.
 *
 * Its own screen rather than a mode of Chat home, because a long press there
 * already opens the row's menu. Discord's mobile app does the same: channels
 * are reordered from the server's channel settings, not the chat list.
 */
export default function ArrangeChannelsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const permissions = usePermissionList();
  const allowed = can("channels:manage", permissions);
  const channelsQuery = useChannels();
  const categoriesQuery = useCategories();
  const reorder = useReorderChannels();
  const reorderCategories = useReorderCategories();
  const categoryIds = useMemo(
    () => selectCategories(categoriesQuery.data).map((category) => category.id),
    [categoriesQuery.data],
  );
  const [categoryFailed, setCategoryFailed] = useState(false);
  const moveCategoryBy = useCallback(
    (id: string, label: string, delta: -1 | 1) => {
      const next = moveCategory(categoryIds, id, delta);
      if (!next) return;
      selectionHaptic();
      setCategoryFailed(false);
      AccessibilityInfo.announceForAccessibility(
        categoryMovedAnnouncement(next, label, id),
      );
      // The hook writes the new order into the list at once and puts it back
      // if the server refuses.
      reorderCategories.mutateAsync(next).catch(() => setCategoryFailed(true));
    },
    [categoryIds, reorderCategories],
  );

  const base = useMemo(
    () =>
      arrangeEntries(
        selectChannels(channelsQuery.data),
        selectCategories(categoriesQuery.data),
      ),
    [channelsQuery.data, categoriesQuery.data],
  );
  // A drop shows at once; the next read of the list (the save's own
  // optimistic write, or a refetch) replaces it.
  const [override, setOverride] = useState<{
    from: ArrangeEntry[];
    entries: ArrangeEntry[];
  } | null>(null);
  const entries = override && override.from === base ? override.entries : base;
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);

  const heldIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const count = useSharedValue(entries.length);
  useLayoutEffect(() => {
    count.set(entries.length);
  }, [entries.length, count]);

  // The held row's offset goes back to zero only once the list has redrawn
  // in its new order, so the row doesn't flash at its old place first.
  const resetPending = useRef(false);
  useLayoutEffect(() => {
    if (!resetPending.current) return;
    resetPending.current = false;
    heldIndex.set(-1);
    dragY.set(0);
  }, [entries, heldIndex, dragY]);

  const move = useCallback(
    (from: number, to: number) => {
      const moved = moveChannelEntry(entries, from, to);
      if (!moved) return false;
      setOverride({ from: base, entries: moved.entries });
      setFailed(false);
      AccessibilityInfo.announceForAccessibility(
        movedAnnouncement(
          moved.entries,
          dropIndex(from, to - from, entries.length),
        ),
      );
      reorder.mutateAsync(moved.write).catch(() => {
        setOverride(null);
        setFailed(true);
      });
      return true;
    },
    [entries, base, reorder],
  );

  const onDragStart = useCallback(() => {
    pressHaptic();
    setDragging(true);
  }, []);

  const onDrop = useCallback(
    (from: number, rows: number) => {
      setDragging(false);
      if (rows !== 0 && move(from, from + rows)) {
        selectionHaptic();
        resetPending.current = true;
        return;
      }
      heldIndex.set(-1);
      dragY.set(0);
    },
    [move, heldIndex, dragY],
  );

  const loading = channelsQuery.isPending || categoriesQuery.isPending;

  return (
    <ScreenShell
      back={BACK_TO_CHAT}
      title="Arrange channels"
      subtitle="Drag a channel by its handle. Everyone in the chapter sees this order."
      scrollEnabled={!dragging}
    >
      {!allowed ? (
        <InlineNote>
          Only officers who manage channels can arrange them.
        </InlineNote>
      ) : loading ? null : channelsQuery.isError &&
        channelsQuery.data === undefined ? (
        <InlineNote
          action={{
            label: "Try again",
            onPress: () => void channelsQuery.refetch(),
          }}
        >
          Couldn&apos;t load the channels.
        </InlineNote>
      ) : (
        <View>
          {failed ? (
            <Text style={styles.failure} accessibilityLiveRegion="polite">
              Couldn&apos;t save the channel order. Nothing changed. Check your
              connection and try again.
            </Text>
          ) : null}
          {categoryFailed ? (
            <Text style={styles.failure} accessibilityLiveRegion="polite">
              Couldn&apos;t move the category. Nothing changed. Check your
              connection and try again.
            </Text>
          ) : null}
          <View>
            {entries.map((entry, index) => (
              <ArrangeRow
                key={entry.key}
                entry={entry}
                index={index}
                heldIndex={heldIndex}
                dragY={dragY}
                count={count}
                onDragStart={onDragStart}
                onDrop={onDrop}
                onMove={(to) => move(index, to)}
                categoryPlace={
                  entry.kind === "heading" && entry.categoryId !== null
                    ? {
                        first: categoryIds.indexOf(entry.categoryId) === 0,
                        last:
                          categoryIds.indexOf(entry.categoryId) ===
                          categoryIds.length - 1,
                        onMove: (delta) =>
                          moveCategoryBy(entry.categoryId!, entry.label, delta),
                      }
                    : null
                }
                movesLocked={dragging}
              />
            ))}
          </View>
        </View>
      )}
    </ScreenShell>
  );
}

function ArrangeRow({
  entry,
  index,
  heldIndex,
  dragY,
  count,
  onDragStart,
  onDrop,
  onMove,
  categoryPlace,
  movesLocked,
}: {
  entry: ArrangeEntry;
  index: number;
  heldIndex: SharedValue<number>;
  dragY: SharedValue<number>;
  count: SharedValue<number>;
  onDragStart: () => void;
  onDrop: (from: number, rows: number) => void;
  onMove: (to: number) => void;
  /** A category heading's place, for its Move up and Move down arrows. */
  categoryPlace: {
    first: boolean;
    last: boolean;
    onMove: (delta: -1 | 1) => void;
  } | null;
  /** While a channel is held, the arrows wait. */
  movesLocked: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // A plain string for the worklet, not the whole token tree.
  const liftedFill = tokens.color.surface.popover;

  const animated = useAnimatedStyle(() => {
    const held = heldIndex.get();
    if (held === index) {
      return {
        transform: [{ translateY: dragY.get() }, { scale: 1.02 }],
        zIndex: 10,
        backgroundColor: liftedFill,
      };
    }
    let shift = 0;
    if (held >= 0) {
      const target = Math.max(
        1,
        Math.min(count.get() - 1, held + Math.round(dragY.get() / ROW_HEIGHT)),
      );
      if (held < index && index <= target) shift = -ROW_HEIGHT;
      else if (target <= index && index < held) shift = ROW_HEIGHT;
    }
    return {
      transform: [
        {
          translateY: held >= 0 ? withTiming(shift, { duration: SHIFT_MS }) : 0,
        },
        { scale: 1 },
      ],
      zIndex: 0,
      backgroundColor: "transparent",
    };
  });

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin(() => {
          heldIndex.set(index);
          dragY.set(0);
          runOnJS(onDragStart)();
        })
        .onUpdate((event) => {
          dragY.set(event.translationY);
        })
        .onFinalize(() => {
          const rows = Math.round(dragY.get() / ROW_HEIGHT);
          runOnJS(onDrop)(index, rows);
        }),
    [index, heldIndex, dragY, onDragStart, onDrop],
  );

  if (entry.kind === "heading") {
    return (
      <Animated.View style={[styles.heading, animated]}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={styles.headingText}
        >
          {entry.label}
        </Text>
        {categoryPlace ? (
          <View style={styles.headingMoves}>
            <IconButton
              label={`Move ${entry.label} up`}
              disabled={categoryPlace.first || movesLocked}
              onPress={() => categoryPlace.onMove(-1)}
            >
              <DisclosureGlyph
                color={
                  categoryPlace.first
                    ? tokens.color.border.hairline
                    : tokens.color.text.mutedForeground
                }
                direction="up"
              />
            </IconButton>
            <IconButton
              label={`Move ${entry.label} down`}
              disabled={categoryPlace.last || movesLocked}
              onPress={() => categoryPlace.onMove(1)}
            >
              <DisclosureGlyph
                color={
                  categoryPlace.last
                    ? tokens.color.border.hairline
                    : tokens.color.text.mutedForeground
                }
                direction="down"
              />
            </IconButton>
          </View>
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[styles.row, animated]}
      accessible
      accessibilityLabel={`${entry.isPrivate ? "Private channel" : "Channel"} ${entry.name}`}
      accessibilityActions={[
        { name: "moveUp", label: "Move up" },
        { name: "moveDown", label: "Move down" },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "moveUp") onMove(index - 1);
        if (event.nativeEvent.actionName === "moveDown") onMove(index + 1);
      }}
    >
      <Text numberOfLines={1} style={styles.name}>
        {entry.name}
      </Text>
      <GestureDetector gesture={pan}>
        <View
          style={styles.handle}
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

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    heading: {
      height: ROW_HEIGHT,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: tokens.spacing.sm,
      paddingBottom: tokens.spacing.xs,
    },
    headingText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      flex: 1,
    },
    // Two arrows at the handle's column, with the 44pt floor from slop.
    headingMoves: {
      flexDirection: "row",
      gap: tokens.spacing.lg,
      paddingRight: (tokens.touch.minimum - ICON_BUTTON_SIZE) / 2,
    },
    row: {
      height: ROW_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
    },
    name: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    handle: {
      width: tokens.touch.minimum,
      height: ROW_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
    },
    failure: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      paddingBottom: tokens.spacing.sm,
    },
  });
}

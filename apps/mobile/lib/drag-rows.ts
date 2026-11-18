import { useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import {
  runOnJS,
  useAnimatedStyle,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/** How long a row takes to slide out of the held row's way. */
const SHIFT_MS = 150;

/**
 * One row of a list reordered by dragging a handle, where every row is the
 * same height so a drag's distance is a count of rows. The list holds the
 * shared state (`heldIndex`, -1 while nothing is held; `dragY`; `count`); each
 * row gets the style that lifts it while held or slides it aside while
 * another passes, and the pan gesture for its handle. Letting go calls
 * `onDrop(from, rows)`, which moves the item and resets the shared state.
 *
 * Used by Arrange channels (#3838) and Edit Activity (#5520), the phone's
 * two drag-to-reorder lists. `minIndex` is the first place a row may land
 * (Arrange channels keeps row 0, a heading, in place).
 */
export function useDragRow({
  index,
  rowHeight,
  minIndex = 0,
  liftedFill,
  heldIndex,
  dragY,
  count,
  onDragStart,
  onDrop,
}: {
  index: number;
  rowHeight: number;
  minIndex?: number;
  /** The held row's fill, as a plain string for the worklet. */
  liftedFill: string;
  heldIndex: SharedValue<number>;
  dragY: SharedValue<number>;
  count: SharedValue<number>;
  onDragStart: () => void;
  onDrop: (from: number, rows: number) => void;
}) {
  const style = useAnimatedStyle(() => {
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
        minIndex,
        Math.min(count.get() - 1, held + Math.round(dragY.get() / rowHeight)),
      );
      if (held < index && index <= target) shift = -rowHeight;
      else if (target <= index && index < held) shift = rowHeight;
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
          const rows = Math.round(dragY.get() / rowHeight);
          runOnJS(onDrop)(index, rows);
        }),
    [index, rowHeight, heldIndex, dragY, onDragStart, onDrop],
  );

  return { style, pan };
}

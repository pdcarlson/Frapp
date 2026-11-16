// The one place allowed to import the library's own scrollables.
/* eslint-disable no-restricted-imports */
import {
  BottomSheetFlatList as LibraryFlatList,
  BottomSheetScrollView as LibraryScrollView,
  useScrollEventsHandlersDefault,
  type ScrollEventsHandlersHookType,
} from "@gorhom/bottom-sheet";
/* eslint-enable no-restricted-imports */
import { forwardRef, useMemo, type ComponentProps } from "react";

/**
 * The bottom sheet library's scrollables, with its scroll lock made safe to
 * re-enter (FRAPP-MOBILE-10).
 *
 * While a sheet is not fully open, the library locks the list inside it: each
 * scroll event calls Reanimated's `scrollTo` to pin the list back in place. On
 * the new architecture `scrollTo` delivers the scroll event it causes
 * synchronously, inside the call, so the handler runs again before it has
 * returned, pins again, and so on until the JS stack runs out. A staging iPhone
 * crashed this way on 2026-11-15 when the member dragged a sheet's handle on
 * coming back to the app: `useAnimatedScrollHandler` -> `scrollTo` ->
 * `useScrollEventsHandlersDefault`, over and over.
 *
 * The guard drops an event that arrives while one of the handlers is still
 * running. Such an event can only be the one the handler's own `scrollTo`
 * just caused, and the position it reports is the one the handler pinned, so
 * nothing is lost. Every other event goes through the library's own handlers
 * unchanged.
 *
 * Import `BottomSheetScrollView` and `BottomSheetFlatList` from here, never
 * from `@gorhom/bottom-sheet` (the lint rule enforces it).
 */

type GuardContext = { frappInScrollHandler?: boolean };
type Handler = (payload: never, context: never) => void;

export function guardScrollHandler<H extends Handler | undefined>(
  handler: H,
): H {
  if (!handler) return handler;
  const run = handler as unknown as (
    payload: unknown,
    context: GuardContext,
  ) => void;
  const wrapped = (payload: unknown, context: GuardContext) => {
    "worklet";
    if (context.frappInScrollHandler) return;
    context.frappInScrollHandler = true;
    try {
      run(payload, context);
    } finally {
      context.frappInScrollHandler = false;
    }
  };
  return wrapped as unknown as H;
}

const useGuardedScrollEventsHandlers: ScrollEventsHandlersHookType = (
  ref,
  contentOffsetY,
) => {
  const library = useScrollEventsHandlersDefault(ref, contentOffsetY);
  const {
    handleOnScroll,
    handleOnBeginDrag,
    handleOnEndDrag,
    handleOnMomentumBegin,
    handleOnMomentumEnd,
  } = library;
  return useMemo(
    () => ({
      handleOnScroll: guardScrollHandler(handleOnScroll),
      handleOnBeginDrag: guardScrollHandler(handleOnBeginDrag),
      handleOnEndDrag: guardScrollHandler(handleOnEndDrag),
      handleOnMomentumBegin: guardScrollHandler(handleOnMomentumBegin),
      handleOnMomentumEnd: guardScrollHandler(handleOnMomentumEnd),
    }),
    [
      handleOnScroll,
      handleOnBeginDrag,
      handleOnEndDrag,
      handleOnMomentumBegin,
      handleOnMomentumEnd,
    ],
  );
};

type ScrollViewProps = ComponentProps<typeof LibraryScrollView>;
type ScrollViewRef = React.ComponentRef<typeof LibraryScrollView>;

export const BottomSheetScrollView = forwardRef<ScrollViewRef, ScrollViewProps>(
  function BottomSheetScrollView(props, ref) {
    return (
      <LibraryScrollView
        scrollEventsHandlersHook={useGuardedScrollEventsHandlers}
        {...props}
        ref={ref}
      />
    );
  },
);

type FlatListProps = ComponentProps<typeof LibraryFlatList>;
type FlatListRef = React.ComponentRef<typeof LibraryFlatList>;

const GuardedFlatList = forwardRef<FlatListRef, FlatListProps>(
  function BottomSheetFlatList(props, ref) {
    return (
      <LibraryFlatList
        scrollEventsHandlersHook={useGuardedScrollEventsHandlers}
        {...props}
        ref={ref}
      />
    );
  },
);

/** Keeps the library's generic item type at every call site. */
export const BottomSheetFlatList =
  GuardedFlatList as unknown as typeof LibraryFlatList;

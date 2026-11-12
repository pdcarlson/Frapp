import { useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  MESSAGES_SWIPE_ACTIVATE_X,
  MESSAGES_SWIPE_FAIL_Y,
  opensMessages,
} from "@/lib/chat/messages-swipe";

/**
 * Chat home's swipe to Messages (#3774): a slide right to left opens it, as
 * the top-right door does. The rule for what counts is
 * `lib/chat/messages-swipe.ts`. JS-thread callbacks: the release only
 * navigates.
 *
 * `enabled` is false while anything is open over the screen (a menu, a row's
 * actions), the way an open overlay holds screen gestures elsewhere
 * (`useHoldSwipeBack`): a drag across a menu must not open Messages behind
 * it. A pan the system cancels (`success` false) opens nothing.
 */
export function MessagesSwipeArea({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .runOnJS(true)
        .activeOffsetX([MESSAGES_SWIPE_ACTIVATE_X, Number.MAX_SAFE_INTEGER])
        .failOffsetY([-MESSAGES_SWIPE_FAIL_Y, MESSAGES_SWIPE_FAIL_Y])
        .onEnd((event, success) => {
          if (success && opensMessages(event)) router.push("/messages");
        }),
    [router, enabled],
  );
  return (
    <GestureDetector gesture={swipe}>
      <View style={styles.area}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ area: { flex: 1 } });

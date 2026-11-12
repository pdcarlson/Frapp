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
 * Chat home's swipe to Messages (#3774): a slide right to left opens it, and
 * it comes in from the right as the top-right door opens it. The rule for
 * what counts is `lib/chat/messages-swipe.ts`. JS-thread callbacks: the
 * release only navigates.
 */
export function MessagesSwipeArea({ children }: { children: ReactNode }) {
  const router = useRouter();
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([MESSAGES_SWIPE_ACTIVATE_X, Number.MAX_SAFE_INTEGER])
        .failOffsetY([-MESSAGES_SWIPE_FAIL_Y, MESSAGES_SWIPE_FAIL_Y])
        .onEnd((event) => {
          if (opensMessages(event)) router.push("/messages");
        }),
    [router],
  );
  return (
    <GestureDetector gesture={swipe}>
      <View style={styles.area}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ area: { flex: 1 } });

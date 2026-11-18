import { useEffect, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useNavigationContainerRef } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { signetDarkTokens } from "@repo/theme/signet";
import {
  launchGate,
  useLaunchLifted,
  type LaunchGate,
} from "@/lib/launch/launch-gate";
import { landedScreen } from "@/lib/launch/landed";
import {
  LAUNCH_BACKGROUND,
  LAUNCH_EMBLEM_SIZE,
  launchEmblem,
} from "@/lib/launch/launch-look";
import { cubicBezierPoints } from "@/lib/motion-easing";
import { useReduceMotion } from "@/lib/use-reduce-motion";

/** One breath, in then out: 4% larger and a fifth dimmer at its peak. */
export const BREATH_MS = 1_400;
export const BREATH_SCALE = 0.04;
export const BREATH_DIM = 0.2;
/** How much larger the emblem eases as the cover fades away. */
export const EXIT_SCALE = 0.08;
/** The fade into the screen: the motion scale's context step, on its exit curve. */
export const EXIT_MS = signetDarkTokens.motion.duration.context;
const EXIT_EASING = Easing.bezier(
  ...cubicBezierPoints(signetDarkTokens.motion.easing.exit),
);

/**
 * The launch logo (#5449, `spec/ui/mobile/navigation.md` § Launch).
 *
 * Over everything the root layout draws, from the app's first frame until
 * {@link launchGate} lifts: the screen the member lands on has its content,
 * or about four seconds have passed. It draws exactly what the native splash
 * draws (`lib/launch/launch-look.ts`), so the native splash hides under it with
 * nothing to see, and the update reload screen hands over to it the same way.
 * While it waits, the emblem breathes; with Reduce Motion on it holds still.
 * Then the cover fades into the screen, the emblem easing a little larger
 * (still, with Reduce Motion), and unmounts.
 *
 * The emblem is ADR-25's, animated as a whole image and never redrawn.
 *
 * Phones only. The web build has no native splash for it to continue, and
 * lifts the gate at once so nothing there waits on it.
 */
export function LaunchCover({
  appMounted,
  gate = launchGate,
}: {
  /**
   * Whether the app under it has mounted (Figtree registered or failed).
   * Until then it stays whatever the gate says, as the native splash it
   * replaces did, so even the cap never lifts it onto nothing.
   */
  appMounted: boolean;
  gate?: LaunchGate;
}) {
  if (Platform.OS === "web") return <WebNoCover gate={gate} />;
  return <PhoneCover gate={gate} appMounted={appMounted} />;
}

function WebNoCover({ gate }: { gate: LaunchGate }) {
  useEffect(() => {
    gate.lift("now");
    void SplashScreen.hideAsync();
  }, [gate]);
  return null;
}

function PhoneCover({
  gate,
  appMounted,
}: {
  gate: LaunchGate;
  appMounted: boolean;
}) {
  const liftedFor = useLaunchLifted(gate);
  const lifted = appMounted ? liftedFor : null;
  const reduceMotion = useReduceMotion();
  const [gone, setGone] = useState(false);
  const breath = useSharedValue(0);
  const exit = useSharedValue(0);

  useLandedReport(gate);

  // Breathe while it waits, starting from rest so the first frame is the
  // splash's.
  useEffect(() => {
    if (reduceMotion || lifted) {
      cancelAnimation(breath);
      return;
    }
    breath.set(
      withRepeat(
        withTiming(1, {
          duration: BREATH_MS / 2,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(breath);
  }, [reduceMotion, lifted, breath]);

  useEffect(() => {
    if (!lifted) return;
    // A cover that lifts before its emblem reported drawn (the cap on a very
    // slow start) must not leave the native splash on top.
    void SplashScreen.hideAsync();
    exit.set(withTiming(1, { duration: EXIT_MS, easing: EXIT_EASING }));
    const timer = setTimeout(() => setGone(true), EXIT_MS);
    return () => clearTimeout(timer);
  }, [lifted, exit]);

  const coverStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.get() }));
  const emblemStyle = useAnimatedStyle(() => ({
    opacity: interpolate(breath.get(), [0, 1], [1, 1 - BREATH_DIM]),
    transform: [
      {
        scale:
          interpolate(breath.get(), [0, 1], [1, 1 + BREATH_SCALE]) *
          (reduceMotion ? 1 : 1 + EXIT_SCALE * exit.get()),
      },
    ],
  }));

  if (gone) return null;

  return (
    <Animated.View
      testID="launch-cover"
      style={[styles.cover, coverStyle]}
      // Takes the touches and the screen reader while it covers; lets both
      // through as it fades.
      pointerEvents={lifted ? "none" : "auto"}
      accessible={!lifted}
      accessibilityViewIsModal={!lifted}
      accessibilityLabel="Frapp is opening"
    >
      <Animated.Image
        source={launchEmblem()}
        style={[styles.emblem, emblemStyle]}
        resizeMode="contain"
        // Android fades a newly loaded image in by default; the splash
        // underneath has it at full strength already.
        fadeDuration={0}
        onLoad={hideNativeSplashNextFrame}
        accessibilityIgnoresInvertColors
      />
    </Animated.View>
  );
}

/**
 * The native splash goes once the emblem is loaded and a frame has drawn it,
 * so what shows underneath is the same image in the same place.
 */
function hideNativeSplashNextFrame(): void {
  requestAnimationFrame(() => {
    void SplashScreen.hideAsync();
  });
}

/**
 * Tells the gate whether a screen is in front yet, from the navigation
 * container's state (`lib/launch/landed.ts`), until the gate lifts.
 */
function useLandedReport(gate: LaunchGate): void {
  const container = useNavigationContainerRef();
  useEffect(() => {
    const read = () => {
      const state = container.isReady() ? container.getRootState() : undefined;
      gate.setLanded(landedScreen(state) !== null);
    };
    read();
    return container.addListener("state", read);
  }, [container, gate]);
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: LAUNCH_BACKGROUND,
    alignItems: "center",
    justifyContent: "center",
  },
  emblem: {
    width: LAUNCH_EMBLEM_SIZE,
    height: LAUNCH_EMBLEM_SIZE,
  },
});

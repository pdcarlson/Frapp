import { FadeIn, ReduceMotion } from "react-native-reanimated";
import type { SignetTokens } from "@repo/theme/signet";

/**
 * How join's views and setup's steps arrive: each fades in over the standard
 * duration rather than replacing the last in one frame, and not at all for a
 * member who reduces motion (the view still changes, just at once). One
 * builder for both, so the two flows can't fade differently, or only one of
 * them honor the setting.
 */
export function stepFadeIn(tokens: SignetTokens) {
  return FadeIn.duration(tokens.motion.duration.standard).reduceMotion(
    ReduceMotion.System,
  );
}

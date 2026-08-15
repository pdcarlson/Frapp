import { Redirect, Stack } from "expo-router";
import { resolveAuthGate } from "@/lib/auth-gate";
import { useAuthSession } from "@/lib/auth-session";

/**
 * The `(auth)` group is the pre-chapter-context stack, not merely the
 * signed-out one.
 *
 * It used to redirect every authenticated member straight to `(tabs)`, which
 * was correct while `sign-in` was the only screen here. It stopped being
 * correct once the group gained post-auth screens: `chapter-picker` (#764) is
 * by definition reached while signed in, and s02/s03 (join, welcome) sit on the
 * same side of the boundary. An unconditional redirect makes all three
 * unreachable.
 *
 * So the gate now keys on *chapter context* rather than on session alone: a
 * member with a resolved chapter belongs in `(tabs)`; a member without one has
 * business here. `(tabs)/_layout.tsx` holds the mirror of this rule, and the
 * two do not loop — each redirects only on the condition the other admits.
 */
export default function AuthLayout() {
  const { status, chapterId, isChapterResolving } = useAuthSession();
  const destination = resolveAuthGate({ status, chapterId, isChapterResolving });

  if (destination === "hold") {
    return null;
  }

  // `tabs` is the only destination outside this group, so it is the only one
  // that redirects. "sign-in" and "picker" both live here and simply render.
  if (destination === "tabs") {
    return <Redirect href="/(tabs)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

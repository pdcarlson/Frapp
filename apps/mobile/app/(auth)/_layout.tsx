import { Redirect, Stack, usePathname } from "expo-router";
import { resolveAuthGate } from "@/lib/auth-gate";
import { useAuthSession } from "@/lib/auth-session";

/**
 * Pin the group's anchor to sign-in.
 *
 * With one screen in here this was implicit. It stopped being so when the group
 * grew to four: expo-router's `sortRoutes` breaks ties on route-name *length*,
 * so the anchor silently became `join` — the shortest name, and a stub. The
 * anchor is what sits under a screen reached by deep link, so backing out of
 * `frapp://chapter-picker` would have landed on an unbuilt screen instead of
 * sign-in. (`anchor` is this version's name for it; `initialRouteName` is still
 * read as a fallback.)
 */
export const unstable_settings = {
  anchor: "sign-in",
};

/**
 * The `(auth)` group is the pre-chapter-context stack, not merely the
 * signed-out one.
 *
 * It used to redirect every authenticated member straight to `(tabs)`, which
 * was correct while `sign-in` was the only screen here. It stopped being
 * correct once the group gained post-auth screens: the chapter picker (#764) is
 * by definition reached while signed in, so an unconditional redirect makes it
 * unreachable.
 *
 * `PRE_CHAPTER_ROUTES` is the exemption list — screens an authenticated member
 * is allowed to sit on. Everything else in the group still bounces to `(tabs)`
 * once they have a session, so sign-in cannot be reopened over a live one.
 */
const PRE_CHAPTER_ROUTES = ["/chapter-picker", "/join", "/welcome"];

export default function AuthLayout() {
  const { status, chapterId, isChapterResolving } = useAuthSession();
  const pathname = usePathname();
  const destination = resolveAuthGate({ status, chapterId, isChapterResolving });

  if (destination === "hold") {
    return null;
  }

  // `tabs` is the only destination outside this group, so it is the only one
  // that redirects — and not when the member deliberately opened one of the
  // post-auth screens that lives here.
  if (destination === "tabs" && !PRE_CHAPTER_ROUTES.includes(pathname)) {
    return <Redirect href="/(tabs)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

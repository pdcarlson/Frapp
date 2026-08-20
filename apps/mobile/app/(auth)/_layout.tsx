import { Redirect, Stack, usePathname } from "expo-router";
import { useAuthGateDestination } from "@/lib/onboarding/use-auth-gate";

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
 * Join (s02) and first-run (s03) are *routed to* from `resolveAuthGate` once
 * `GET /v1/chapters` is in, not merely reachable. The chapter picker stays a
 * deliberate destination from More — it is exempt when the gate says `tabs` so
 * a finished member can still switch chapters.
 *
 * `create-chapter` (#1102 / #1084) is the first-officer wizard. Listing it
 * here is the exemption the wizard needs so a successful onboard does not yank
 * the officer off the last step. Join and welcome are *not* on this list:
 * once onboarding is marked complete, staying on s03 would strand them (the
 * #957 finding). They are allowed only while the gate destination is join /
 * welcome respectively.
 *
 * `#1102` named this list `PRE_CHAPTER_ROUTES`; this PR named it
 * `DELIBERATE_AUTH_ROUTES`. Both spellings are kept and must stay in lockstep
 * so `/create-chapter` cannot drop off one of them.
 */
const DELIBERATE_AUTH_ROUTES = ["/chapter-picker", "/create-chapter"];
const PRE_CHAPTER_ROUTES = DELIBERATE_AUTH_ROUTES;

export default function AuthLayout() {
  const pathname = usePathname();
  const destination = useAuthGateDestination();

  if (destination === "hold") {
    return null;
  }

  if (destination === "sign-in") {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  if (destination === "join") {
    if (pathname === "/join" || DELIBERATE_AUTH_ROUTES.includes(pathname)) {
      return <Stack screenOptions={{ headerShown: false }} />;
    }
    return <Redirect href="/join" />;
  }

  if (destination === "welcome") {
    if (pathname === "/welcome") {
      return <Stack screenOptions={{ headerShown: false }} />;
    }
    return <Redirect href="/welcome" />;
  }

  // `tabs` — bounce out of this group unless the member opened a deliberate
  // post-auth screen. Join and welcome are *not* exempt here: once onboarding
  // is marked complete, staying on s03 would strand them (the #957 finding).
  if (PRE_CHAPTER_ROUTES.includes(pathname)) {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  return <Redirect href="/(tabs)" />;
}

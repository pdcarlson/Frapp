import { useCallback, useRef } from "react";
import { Redirect, Tabs, useFocusEffect } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { ScreenShell } from "@/components/screen-shell";
import { AskSheet } from "@/components/ask/ask-sheet";
import { AskPill } from "@/components/chat/ask-pill";
import { isAskAvailable } from "@/lib/ask/flag";

/**
 * s17 — Ask (`spec/ui/mobile/screens.md` s17).
 *
 * **Ask is a sheet, not a screen.** It is hosted by Chat home (s04) and Events
 * (s06) behind the global ✦ pill, never as a fifth tab
 * (`spec/ui/mobile/navigation.md` § Global entries), and
 * `spec/ui/mobile/patterns.md` § Bottom sheets lists "the s17 Ask presentation"
 * among the flows that are sheets on their parent screen. So this route hosts
 * no unique UI: it presents the same `AskSheet` the two real entry points do.
 *
 * ## Why the file still exists
 *
 * `app/(tabs)/_layout.tsx` is frozen under #937's hotspot protocol and
 * registers `<Tabs.Screen name="ask" options={{ title: "Ask", href: null }} />`.
 * expo-router throws at runtime for a registration with no backing file — the
 * case `lib/routes.spec.ts` guards with "backs every registration with a real
 * route file" — so deleting this would need the frozen layout reopened. It
 * also keeps a stale `frapp://ask` deep link landing somewhere real rather than
 * on `+not-found`.
 *
 * ## A build without Ask redirects to Chat home
 *
 * With `isAskAvailable()` false there is no Ask anywhere in the app (#2259,
 * owner decision 2026-09-22): no pill, and `AskSheet` renders nothing. Drawing
 * this route's shell anyway would put an "Ask" screen with nothing in it in
 * front of whoever followed `frapp://ask`, which is the placeholder the
 * decision removed. Chat home is where `+not-found` sends a stale link too.
 *
 * The redirect also hides this route's header. The frozen layout gives the
 * `ask` registration a title and leaves the tab navigator's header on, and
 * `Redirect` navigates from an effect, so without this the arrival paints one
 * frame of an empty screen under an "Ask" header before Chat home replaces it
 * — the same placeholder, briefly. `Tabs.Screen` inside a route sets that
 * route's own options from a layout effect (expo-router `views/Screen.js`),
 * which lands before the first paint and leaves `_layout.tsx` untouched.
 */
export default function AskScreen() {
  if (isAskAvailable()) {
    return <AskRoute />;
  }
  return (
    <>
      <Tabs.Screen options={NO_HEADER} />
      <Redirect href="/" />
    </>
  );
}

/**
 * Hoisted so the options object keeps its identity: `Tabs.Screen` re-runs
 * `setOptions` whenever `options` changes, and an inline literal changes on
 * every render.
 */
const NO_HEADER = { headerShown: false } as const;

/**
 * The route with Ask switched on. Split out so its hooks run only on the path
 * that uses them, rather than presenting a ref that was never attached on the
 * way to a redirect.
 *
 * The shell behind the sheet is deliberately bare: everything a member came for
 * is in the sheet, and duplicating the answer surface here would be a second
 * implementation of s17 to keep in sync. Dismissing the sheet leaves the shell
 * with the ✦ pill in its header, so the way back in is the same control it is
 * everywhere else — not a dead end.
 */
function AskRoute() {
  const sheetRef = useRef<BottomSheetModal>(null);

  const present = useCallback(() => sheetRef.current?.present(), []);

  // On every arrival, not just the first. `ask` is a `Tabs.Screen`
  // registration, and React Navigation keeps a tab screen mounted for the rest
  // of the session once it has been focused — so a mount effect fires exactly
  // once, and the *second* `frapp://ask` link would land on the deliberately
  // bare shell this effect exists to prevent. `useFocusEffect` is the shape
  // that survives a kept-mounted tab; `present()` is idempotent on an
  // already-presented modal, so re-focusing while it is open is a no-op.
  useFocusEffect(present);

  return (
    <ScreenShell
      title="Ask"
      subtitle="Ask about your chapter's bylaws, minutes and announcements."
      headerAction={<AskPill onPress={present} />}
    >
      <AskSheet ref={sheetRef} />
    </ScreenShell>
  );
}

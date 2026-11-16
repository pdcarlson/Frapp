import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { AskSheet } from "@/components/ask/ask-sheet";
import { useAiSurfaces } from "@/lib/ai/availability";

/**
 * s17, Ask (`spec/ui/mobile/screens.md` s17).
 *
 * **Ask is a sheet, not a screen.** Its entry is the Ask Frapp bar above the
 * tab bar (`ask-bar.tsx`; `spec/ui/mobile/navigation.md` § Global entries).
 * This route hosts no UI of its own: it exists so a `frapp://ask` link lands
 * somewhere real, and presents the same `AskSheet`.
 *
 * ## `draft`: words to open with
 *
 * The Search screen's last row, "Ask Frapp about …" (#5139), pushes this
 * route with what was typed as `draft`. It lands in the field for the member
 * to send or change, never sent on its own (`AskSheet`'s `initialDraft`).
 *
 * ## A member without Ask goes to Chat home
 *
 * Whether a member has Ask is the server's answer (`useAiSurfaces`): AI is
 * on, the president has Ask on, and the member's role may use it. When any of
 * those is no there is no Ask anywhere in the app (#2259), so this pops down
 * to Chat home (`dismissTo`, never `<Redirect>`, which would stack a second
 * tab navigator: `navigation.md` § Going back). Until the server has
 * answered, the screen is empty and untitled, and closing the sheet goes to
 * Chat home too, so the bare shell is never a place a member is left.
 */
export default function AskScreen() {
  const router = useRouter();
  const { ask, ready } = useAiSurfaces();
  const toChatHome = useCallback(() => router.dismissTo("/"), [router]);

  useEffect(() => {
    if (ready && !ask) toChatHome();
  }, [ask, ready, toChatHome]);

  // A source's screen is pushed over this one when the member opens it; going
  // to Chat home then would pop that screen straight back off. Coming back
  // from the source lands here, which presents the sheet and its answer again.
  //
  // Opened from Search's "Ask Frapp about …" row (#5139), closing goes back
  // to Search, the screen it came from; a link opened cold has only the tabs
  // under it, so the same pop lands on Chat home.
  const onClosed = useCallback(
    (leftForSource: boolean) => {
      if (leftForSource) return;
      if (router.canGoBack()) router.back();
      else toChatHome();
    },
    [router, toChatHome],
  );

  return ask ? <AskRoute onClosed={onClosed} /> : null;
}

function AskRoute({
  onClosed,
}: {
  onClosed: (leftForSource: boolean) => void;
}) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const present = useCallback(() => sheetRef.current?.present(), []);
  // On every arrival: `present()` is a no-op on a sheet already up.
  useFocusEffect(present);
  const { draft } = useLocalSearchParams<{ draft?: string }>();

  return (
    <AskSheet
      // The sheet reads its first words once, when it mounts.
      key={draft ?? ""}
      ref={sheetRef}
      onClosed={onClosed}
      initialDraft={draft}
    />
  );
}

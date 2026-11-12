import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { AskSheet } from "@/components/ask/ask-sheet";
import { useAiSurfaces } from "@/lib/ai/availability";

/**
 * s17, Ask (`spec/ui/mobile/screens.md` s17).
 *
 * **Ask is a sheet, not a screen.** Its entry is the bar at the top of the
 * tab bar's + panel (`spec/ui/mobile/navigation.md` § Global entries). This
 * route hosts no UI of its own: it exists so a `frapp://ask` link lands
 * somewhere real, and presents the same `AskSheet`.
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

  return ask ? <AskRoute onClosed={toChatHome} /> : null;
}

function AskRoute({ onClosed }: { onClosed: () => void }) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const present = useCallback(() => sheetRef.current?.present(), []);
  // On every arrival: `present()` is a no-op on a sheet already up.
  useFocusEffect(present);

  return <AskSheet ref={sheetRef} onClosed={onClosed} />;
}

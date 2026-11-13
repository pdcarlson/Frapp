import { useMemo } from "react";
import { useBottomSheetInternal } from "@gorhom/bottom-sheet";
import type { SignetTokens } from "@repo/theme/signet";
import { useFrappTheme } from "@/lib/theme";

/**
 * Which step of the surface ladder a card takes on the phone
 * (`spec/ui/design-system/foundations.md` §2, "On the phone a card is one
 * step above the page", #4682).
 *
 * The ladder's steps were spread apart on 2026-11-12 so web's panels could be
 * told apart, and on web a card sits on a `surface1` panel, one step up. A
 * phone has no panel: a card sits straight on `background`, so `surface.card`
 * there was two steps up, and every card jumped off the page (the owner,
 * 2026-11-12: "almost too much contrast"). On the phone a card that sits on
 * the page therefore takes `surface1`, and what needs its own edge inside it
 * takes `card`.
 *
 * A sheet is the other place a card sits. A sheet's own fill is `popover`
 * (`useSheetBackgroundStyle`), and a card in one is `surface.card`, one step
 * under it; that did not change.
 *
 * Chat's own surfaces (a message's bubble, the cards a message carries, the
 * composer) are not routed through here: the team's read on 2026-11-12 was
 * that chat is fine as it is.
 */
export interface RaisedSurfaces {
  /** A card, a grouped list or a round control's fill. */
  card: string;
  /**
   * One step above {@link card}, for what sits inside it and needs an edge of
   * its own: a lead tile, a chip, a row while it is held.
   */
  raised: string;
}

/** The steps for something that sits on a screen's background. */
export function pageSurfaces(tokens: SignetTokens): RaisedSurfaces {
  return {
    card: tokens.color.surface.surface1,
    raised: tokens.color.surface.card,
  };
}

/** The steps for something that sits in a bottom sheet. */
export function sheetSurfaces(tokens: SignetTokens): RaisedSurfaces {
  return {
    card: tokens.color.surface.card,
    raised: tokens.color.surface.popover,
  };
}

/**
 * Whether this component is drawn inside a bottom sheet.
 *
 * A sheet is a portal with no wrapper of ours around its content (each of
 * the app's sheets mounts its own `BottomSheetModal`), so the sheet library's
 * own context is the one thing every sheet's content has in common. `true`
 * asks for `null` outside a sheet instead of a throw.
 */
function useInSheet(): boolean {
  return useBottomSheetInternal(true) != null;
}

/**
 * {@link pageSurfaces} or {@link sheetSurfaces}, for a component both a
 * screen and a sheet draw (`ListSection`, `StateBlock`, `LeadTile`). A
 * component only a screen draws calls `pageSurfaces(tokens)` in its styles.
 */
export function useRaisedSurfaces(): RaisedSurfaces {
  const { tokens } = useFrappTheme();
  const inSheet = useInSheet();
  return useMemo(
    () => (inSheet ? sheetSurfaces(tokens) : pageSurfaces(tokens)),
    [tokens, inSheet],
  );
}

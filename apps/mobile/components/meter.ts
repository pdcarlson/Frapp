import type { SignetTokens } from "@repo/theme/signet";

/**
 * The phone's proportion bar, one recipe for every meter (the poll card's
 * tallies, Activity's required events): a 4pt groove in `--background` (or
 * `trackOnPage`, for one with no card under it) with
 * the chapter accent as its fill. Drawn inside a card, so the groove recedes
 * against the card around it. The web keeps the same rule in
 * `apps/web/components/shared/meter.ts`, which records why the groove is the
 * page background rather than an input tint (a maroon chapter's fill vanished
 * against the other).
 *
 * Callers set the fill's `width` and `backgroundColor` (the chapter accent)
 * themselves; a meter is never the only signal, so the count beside it says
 * the number in words.
 */
export function meterStyles(tokens: SignetTokens) {
  return {
    track: {
      height: 4,
      borderRadius: 2,
      backgroundColor: tokens.color.surface.background,
      overflow: "hidden",
    },
    fill: {
      height: "100%",
      borderRadius: 2,
    },
    /**
     * The one exception to the recess: a meter drawn straight on the screen
     * with no card under it (Activity's Waiting on others rows, #4792). The
     * screen *is* `--background` there, so the groove is a step up, the card
     * surface, which the accent still clears 3:1 against. Never in a card.
     */
    trackOnPage: {
      height: 4,
      borderRadius: 2,
      backgroundColor: tokens.color.surface.card,
      overflow: "hidden",
    },
  } as const;
}

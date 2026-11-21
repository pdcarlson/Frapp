import type { SignetTokens } from "@repo/theme/signet";

/**
 * The phone's proportion bar, one recipe for every meter (the poll card's
 * tallies, Activity's required events and rings, the study goal): a 4pt
 * groove with the chapter accent as its fill. The web keeps the same rule in
 * `apps/web/components/shared/meter.ts`, which records why the groove is a
 * ladder step rather than an input tint (a maroon chapter's fill vanished
 * against the other).
 *
 * The groove's colour depends on what the meter sits on: see
 * {@link meterGrooveOn}. Callers name that surface; they never pick the
 * groove's colour themselves.
 *
 * Callers set the fill's `width` and `backgroundColor` (the chapter accent)
 * themselves; a meter is never the only signal, so the count beside it says
 * the number in words.
 */
export function meterStyles(tokens: SignetTokens, on: string) {
  return {
    track: {
      height: 4,
      borderRadius: 2,
      backgroundColor: meterGrooveOn(tokens, on),
      overflow: "hidden",
    },
    fill: {
      height: "100%",
      borderRadius: 2,
    },
  } as const;
}

/**
 * The groove for a meter drawn on `on`, one of the four ladder steps: the
 * step two away from it, receding where there is room below and rising where
 * there is not.
 *
 * One step away is too faint since the softer 2026-11-19 ladder (#5695): a
 * `--background` groove on a phone card (`--surface-1`, `lib/surfaces.ts`)
 * measured 1.08:1, so an empty week ring was nearly invisible. Two steps is
 * 1.19:1 or more on every step, above the old ladder's 1.17:1. The fill
 * still clears 3:1 against any of them, because the accent engine holds
 * `accent-9` to 3:1 on all four steps (`accent-engine.md` §8).
 *
 * A colour that is not a ladder step (a tint, a pressed row) is treated as the
 * page, the darkest, so the groove rises.
 */
export function meterGrooveOn(tokens: SignetTokens, on: string): string {
  const { background, surface1, card, popover } = tokens.color.surface;
  switch (on) {
    case surface1:
      return popover;
    case card:
    case popover:
      return background;
    case background:
    default:
      return card;
  }
}

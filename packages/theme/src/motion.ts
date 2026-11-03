/**
 * The motion scale: durations (ms) and easing curves.
 *
 * Carried over from the legacy Frapp system. The discipline around it is
 * settled, the numbers are provisional, not Signet canon
 * (`spec/ui/design-system/foundations.md` §11). `signet.ts` serves it as
 * `SignetTokens.motion`, and the Tailwind preset interpolates it into the
 * animation utilities.
 *
 * Its own module because `apps/landing/app/page.spec.ts` reads this file off
 * disk to pin the CSS mirror in `apps/landing/app/globals.css`, matching keys
 * like `standard:` by name. Keep it to this one object.
 */
export const motionTokens = {
  duration: {
    micro: 140,
    standard: 220,
    context: 300,
  },
  easing: {
    standard: "cubic-bezier(0.16, 1, 0.3, 1)",
    entrance: "cubic-bezier(0.22, 1, 0.36, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
  },
} as const;

export type MotionTokens = typeof motionTokens;

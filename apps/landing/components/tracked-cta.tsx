"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import {
  captureLandingCta,
  type LandingCta,
  type LandingCtaSurface,
} from "../lib/posthog/client";

type TrackedCtaProps = ComponentProps<typeof Link> & {
  cta: LandingCta;
  surface: LandingCtaSurface;
};

/**
 * Storefront CTA wrapper: the homepage's controls, plus the header's and
 * footer's on `/about` and `/changelog`. Captures `{ cta, surface }` only —
 * never `href`.
 * Styling is entirely the caller's `className`.
 */
export function TrackedCta({
  cta,
  surface,
  onClick,
  ...props
}: TrackedCtaProps) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        captureLandingCta(cta, surface);
        onClick?.(event);
      }}
    />
  );
}

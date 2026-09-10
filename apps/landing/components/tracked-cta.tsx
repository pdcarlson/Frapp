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
 * Homepage CTA wrapper. Captures `{ cta, surface }` only — never `href`.
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

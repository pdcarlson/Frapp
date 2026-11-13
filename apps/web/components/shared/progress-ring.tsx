import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A ring that fills clockwise from twelve o'clock (#4766): Activity's week
 * ring and the gauges of its semester strip, the phone's `ProgressRing`
 * (`apps/mobile/components/activity/progress-ring.tsx`) on web. The meter's
 * recipe (`meter.ts`) bent round: a groove in `--background`, since a ring is
 * drawn on a card, and the chapter accent as its fill, or the success hue
 * once it closes.
 *
 * Decoration: the count beside or inside it says the number, so the ring is
 * hidden from a screen reader and whatever holds it carries the sentence.
 */
export function ProgressRing({
  size,
  stroke,
  progress,
  tone = "accent",
  children,
  className,
  "data-testid": testId,
}: {
  size: number;
  stroke: number;
  /** 0 to 1. Nothing is drawn at 0, so an empty ring is only its groove. */
  progress: number;
  /** `success` once the ring has closed. */
  tone?: "accent" | "success";
  /** Drawn centred inside the ring. */
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(1, Math.max(0, progress));
  return (
    <span
      aria-hidden="true"
      className={cn("relative block shrink-0", className)}
      style={{ width: size, height: size }}
      data-testid={testId}
      data-progress={filled}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        focusable="false"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-background"
        />
        {filled > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * filled} ${circumference}`}
            // From twelve o'clock, not three.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className={tone === "success" ? "text-success" : "text-primary"}
          />
        ) : null}
      </svg>
      {children ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          {children}
        </span>
      ) : null}
    </span>
  );
}

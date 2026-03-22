import Link from "next/link";

type FrappLockupProps = {
  /** When true, root element is a Link to `/` (default header). */
  asLink?: boolean;
  className?: string;
};

/**
 * Frapp wordmark + app mark. Inline SVG so `currentColor` follows `text-navy` / `dark:text-white`.
 * Geometry aligns with `packages/brand-assets/assets/frapp-lockup.svg` — update both when changing the lockup.
 */
export function FrappLockup({ asLink = true, className }: FrappLockupProps) {
  const svg = (
    <svg
      className={className}
      viewBox="0 0 184 64"
      width={184}
      height={64}
      role="img"
      aria-label="Frapp"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="16" fill="hsl(var(--brand-lockup-bg))" />
      <path
        d="M20 18H46V25H27V31H43V38H27V52H20V18Z"
        fill="hsl(var(--primary))"
        aria-hidden="true"
      />
      <text
        x="76"
        y="44"
        fill="currentColor"
        style={{
          fontFamily:
            "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
          fontSize: "32px",
          fontWeight: 700,
        }}
      >
        frapp
      </text>
    </svg>
  );

  const inner = (
    <span className="inline-flex items-center text-navy dark:text-white [&>svg]:h-8 [&>svg]:w-auto">
      {svg}
    </span>
  );

  if (asLink) {
    return (
      <Link
        href="/"
        className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {inner}
      </Link>
    );
  }

  return inner;
}

import Link from "next/link";

/**
 * Signet wordmark + locked emblem B, wrapped in a Link to `/`. Inline SVG so
 * `currentColor` follows `text-navy` / `dark:text-white` on the word. The tile
 * and crest stay hardcoded `#1A1A1A` / `#DDB844` — the mark never takes theme
 * or chapter accent. Geometry aligns with
 * `packages/brand-assets/assets/frapp-lockup.svg`.
 */
export function FrappLockup() {
  return (
    <Link
      href="/"
      className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="inline-flex items-center text-navy dark:text-white [&>svg]:h-8 [&>svg]:w-auto">
        <svg
          viewBox="0 0 210 64"
          width={210}
          height={64}
          role="img"
          aria-label="Signet"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <mask id="signet-lockup-neck-break">
              <rect width="64" height="64" fill="white" />
              <rect
                x="24.5"
                y="45.2"
                width="12.5"
                height="2.6"
                rx="1.1"
                fill="black"
                transform="rotate(-32 31 46.5)"
              />
            </mask>
          </defs>
          <rect width="64" height="64" rx="16" fill="#1A1A1A" />
          <path
            fill="#DDB844"
            mask="url(#signet-lockup-neck-break)"
            d="M22.2 32.4c.2-8.2 7.8-15.2 18.2-14.2 6.6.7 12.4 5.6 13.8 12.2 1 4.8-.6 9.2-4.8 12.2-2.2 1.6-4.8 2.5-7.6 2.6l-1.2 7.4c-.4 2.2 1.2 4.2 3.4 4.4l.6-4.2c2.8.1 5.6-.6 8-2.2 5.8-4.2 8.2-11.2 6.8-18.2C57.2 19.4 48.2 12.2 38.2 11.2 24.4 9.8 14.8 19.4 14.6 31.4c-.1 5.4 2.6 10.2 7.2 13.2l2.2-3.4c-2.8-2.2-4.6-5.6-4.4-8.8z"
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
            Signet
          </text>
        </svg>
      </span>
    </Link>
  );
}

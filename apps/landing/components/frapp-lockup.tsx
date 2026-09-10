import Link from "next/link";

/**
 * Signet wordmark + locked emblem B, wrapped in a Link to `/`. The word
 * follows `text-navy` / `dark:text-white`. The tile is Design's locked
 * raster (`#1A1A1A` / `#DDB844`); the mark never takes theme or chapter accent.
 */
export function FrappLockup() {
  return (
    <Link
      href="/"
      aria-label="Signet"
      className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span
        className="inline-flex items-center gap-3 text-navy dark:text-white"
        aria-hidden="true"
      >
        <img
          // eslint-disable-next-line @next/next/no-img-element
          src="/brand/signet-emblem-B.png"
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 rounded-lg"
        />
        <span className="text-xl font-bold leading-none">Signet</span>
      </span>
    </Link>
  );
}

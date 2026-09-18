import Link from "next/link";
import { SignetCrest } from "./signet-crest";

/*
 * Signet wordmark + locked emblem B.
 *
 * The crest is INLINED as one path rather than fetched as a raster (#2366).
 * Three reasons, in the order they bind:
 *
 *  1. `spec/ui/landing/README.md` § Performance guards the fold's LCP story —
 *     the hero paints text, and nothing above the fold may become an image
 *     request. The lockup sits in the sticky header, above the fold on every
 *     route including the legal pages, so an inline path removes a request
 *     from that critical path instead of merely keeping it un-`priority`.
 *  2. It scales. The same geometry serves the 32px header tile, the footer tile
 *     and the 56/72px closing crest, with no second raster and no blur. There
 *     is no crest at the fold: D9 put the officer's chat frame there, and the
 *     signature moment that would have played on a hero crest went with it
 *     (cut until brand sign-off, #2378).
 *  3. The mark is LOCKED (`spec/ui/brand-identity.md` §2, `spec/ui/assets.md`
 *     §1), which is why the geometry and its fill are not written here at all:
 *     [`signet-crest.tsx`](./signet-crest.tsx) is their one home, and it carries
 *     the provenance and the never-`var(--primary)` rule.
 *
 * `apps/landing/public/brand/signet-emblem-B.png` deliberately STAYS on disk.
 * It is a synced target of `signet-emblem-B-1024.png` in the `SYNCED` list
 * (`scripts/lib/brand-pixels.mjs`), which `check-brand-assets.mjs` walks, so
 * deleting it turns that gate red. This component simply no longer reads it.
 */
export function FrappLockup() {
  return (
    <Link
      href="/"
      aria-label="Signet"
      className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span
        className="inline-flex items-center gap-3 text-foreground"
        aria-hidden="true"
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xs bg-surface-1">
          <SignetCrest className="h-6 w-6" />
        </span>
        <span className="text-title leading-none">Signet</span>
      </span>
    </Link>
  );
}

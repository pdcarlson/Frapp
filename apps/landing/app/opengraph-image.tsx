import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SIGNET_CREST_GOLD, SIGNET_CREST_PATH } from "../components/signet-crest";

export const runtime = "nodejs";

export const alt = "Signet. Ask your chapter anything.";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

/**
 * Social preview card (Open Graph / Twitter), composed on the Signet stage.
 *
 * Slice 3 (#2368) recomposed this from the token-only pass slice 1 left behind:
 * the stage moves from `--surface-1` to `--background`, the crest stops being a
 * raster, and the type becomes Figtree.
 *
 * COLOURS ARE LITERALS HERE, and that is not a token bypass. Satori renders this
 * with no stylesheet and no cascade, so `var(--x)` has nothing to resolve against
 * and would paint nothing. Each literal below is annotated with the Signet token
 * it mirrors; if the ladder moves, these move with it by hand. `signet.css` is
 * still the source — this file is a transcription of it, not a second opinion.
 *
 * ── Three decisions worth the words ──────────────────────────────────────────
 *
 * **1. The crest is the inline path, not `app/opengraph-emblem.png`.** That
 * raster is `signet-emblem-B-1024.png`, which is colour type 2: RGB with no
 * alpha channel at all, an opaque `#1A1A1A` field with the crest on it. It suited
 * a `#1A1A1A` stage, where the field was invisible. On `#131211` the same file
 * paints a visibly lighter square behind the mark, which is why the stage move
 * and the crest move are one change rather than two. The path here is the same
 * geometry the page inlines, from the same module, so the card and the page's
 * closing crest cannot drift apart.
 *
 * `app/opengraph-emblem.png` therefore stays on disk with nothing reading it,
 * exactly as `public/brand/signet-emblem-B.png` already does: it is a synced
 * target of `signet-emblem-B-1024.png` in the `SYNCED` list
 * (`scripts/lib/brand-pixels.mjs`), which `check-brand-assets.mjs` walks, so
 * deleting it turns that gate red. Both are recorded in
 * `spec/ui/landing/README.md` § Performance.
 *
 * **2. The fonts are static TTFs, and they have to be.** Satori cannot parse the
 * vendored `packages/theme/fonts/FigtreeVF.woff2` that `layout.tsx` loads for the
 * browser — it throws `Unsupported OpenType signature wOF2`, and a variable TTF
 * fails in its own way. So the same typeface is vendored a second time beside it
 * as two static instances, Regular and Bold, which are the only weights this card
 * uses. That is one typeface in two container formats for two renderers, not two
 * sources of truth: both are Figtree 2.002 from the upstream Google Fonts
 * release, and `OFL-Figtree.txt` beside them is the licence for all three.
 *
 * This route prerenders as **static** content, so the read below happens during
 * `next build`, where the whole monorepo is on disk. `next.config.js` names the
 * files in `outputFileTracingIncludes` anyway, against the day something makes
 * this route dynamic: a `readFile` off a computed path is invisible to Next's
 * dependency tracer, so the fonts would be absent from the function and the card
 * would break in production with every check green.
 *
 * **3. The arrangement is not board-drawn.** The Spec sheet's PR 3 line is the
 * entire specification for this card — "composed on the `#131211` stage with the
 * crest and the tagline in Figtree" — and no board draws it. What is below is the
 * page's own closing section (crest, then the line, centred) at social-card scale,
 * chosen so the card and the bottom of the page read as one thing. Do not go
 * looking for a board that agrees with it; there is not one.
 *
 * The tagline is the locked one (`spec/ui/brand-identity.md` §1). D8 holds it off
 * the page BODY until Ask can answer and scopes itself to the body: the meta and
 * OG titles keep it as built, and a brand tagline on a share card is not a product
 * claim about a shipped control.
 */

const FONT_DIR = join(process.cwd(), "..", "..", "packages", "theme", "fonts");

export default async function OpenGraphImage() {
  const [figtreeRegular, figtreeBold] = await Promise.all([
    readFile(join(FONT_DIR, "Figtree-Regular.ttf")),
    readFile(join(FONT_DIR, "Figtree-Bold.ttf")),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#131211", // --background, the Signet stage
        fontFamily: "Figtree",
      }}
    >
      <svg width={148} height={148} viewBox="0 0 1024 1024">
        <path fill={SIGNET_CREST_GOLD} d={SIGNET_CREST_PATH} />
      </svg>
      <div
        style={{
          display: "flex",
          marginTop: 30,
          fontSize: 88,
          fontWeight: 700,
          letterSpacing: "-0.02em", // the marketing hero role's tracking
          lineHeight: 1,
          color: "#EDEAE3", // --foreground
        }}
      >
        Signet
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 18,
          fontSize: 34,
          fontWeight: 400,
          lineHeight: 1.3,
          color: "#A9A399", // --muted-foreground
        }}
      >
        Ask your chapter anything.
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Figtree", data: figtreeRegular, weight: 400, style: "normal" },
        { name: "Figtree", data: figtreeBold, weight: 700, style: "normal" },
      ],
    },
  );
}

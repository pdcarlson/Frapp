import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  deriveSignetPalette,
  signetAccentSemanticVars,
} from "@repo/chapter-theme";

/**
 * The Accent tab's card description makes four promises about where a chapter's
 * colour goes and what it cannot touch. Copy that describes behaviour rots the
 * moment the behaviour moves, and this particular card had rotted four ways at
 * once before lane 7 rewrote it: it promised the accent to PDF reports it has
 * never reached, checked contrast "against white" a year after #1157 moved the
 * check to the dark card, conflated an unparseable hex with a failing one, and
 * deferred the chapter palette to "Chunk 07" from inside chunk 07.
 *
 * So the replacement is pinned rather than trusted. Each assertion below ties
 * one clause to the thing that makes it true, which means the copy fails a test
 * when it stops being accurate instead of being read again in a year.
 */

// `__dirname`, not `import.meta.url`: these specs run under the jsdom
// environment, where `import.meta.url` is not a `file:` URL and
// `fileURLToPath` throws. The node-environment specs in `packages/theme` use
// the URL form and are fine; this one cannot.
const settingsPage = readFileSync(`${__dirname}/settings-page.tsx`, "utf8");

/**
 * Compared with whitespace collapsed, not as a regex over the source lines.
 *
 * The first version pinned today's JSX wrap points with `\s+` at each break,
 * which means re-indenting the card (nesting it in a gate, say) fails a copy
 * assertion on a change that altered no copy \u2014 and the fix a reader reaches for
 * is loosening the regex rather than reading it.
 */
const DESCRIPTION =
  "Paints primary buttons, your own chat bubbles and the nav&apos;s active item. " +
  "Saving derives the rest of the palette from it, and contrast is checked " +
  "against the dark surfaces it lands on. The Signet mark, the Ask pill and " +
  "the scrollbars never change.";

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The rendered copy of the Accent card only, and anchored to that card.
 *
 * Two traps, both of which this originally fell into.
 *
 * 1. **`settings-page.tsx` has five `<CardDescription>` blocks.** A bare
 *    `/<CardDescription>([\s\S]*?)<\/CardDescription>/` matches the first one,
 *    which belongs to the chapter picker, so every negative assertion below ran
 *    against copy it was not about and passed no matter what the Accent card
 *    said. Caught by mutating the real description to re-add "Chunk 07" and
 *    watching all ten tests stay green. It is anchored to `<CardTitle>Accent
 *    color</CardTitle>` now, and `it("is the Accent card's own copy")` fails if
 *    that anchor ever stops finding it.
 * 2. **The docstring above the card quotes all four claims it replaced**, by
 *    design: "this sentence used to say X, and X was false" is the only durable
 *    way to stop someone restoring X. So these assertions must not scan the
 *    file, or they fail on the record and get "fixed" by deleting it.
 *
 * **What this cannot see.** It reads the source rather than rendering
 * `SettingsPage`, so it pins what the card *says*, not that the card is
 * reachable. The Accent tab is the one tab in its group not wrapped in
 * `renderConfigGated(...)`; if a later change gates it, every assertion here
 * stays green while the copy becomes unreachable. Reachability is the tab
 * suite's job (`settings-module-deeplink.spec.tsx`), not this file's.
 */
const description = (() => {
  const card = settingsPage.indexOf("<CardTitle>Accent color</CardTitle>");
  if (card === -1) throw new Error("the Accent card's title moved");
  const block = settingsPage
    .slice(card)
    .match(/<CardDescription>([\s\S]*?)<\/CardDescription>/);
  if (!block?.[1]) throw new Error("the Accent card has no CardDescription");
  return block[1];
})();

describe("the Accent tab says what the accent actually does", () => {
  it("renders the rewritten description", () => {
    expect(collapse(description)).toBe(DESCRIPTION);
  });

  it("is the Accent card's own copy, not another card's", () => {
    // The assertion that makes every negative one below mean something. See
    // trap 1 in the comment above `description`.
    expect(description).toMatch(/Paints primary buttons/);
    expect(description).not.toMatch(/Select an active chapter/);
  });

  it("no longer promises the accent to a PDF it never reached", () => {
    // `report-pdf.renderer.ts` draws from five fixed constants and the branding
    // payload `report-export.service.ts` hands it carries no colour at all.
    expect(description).not.toMatch(/PDF/);
  });

  it("no longer claims the check runs against white", () => {
    expect(description).not.toMatch(/white/);
  });

  it("checks contrast against the surface it actually lands on", () => {
    // #1157 moved this and the copy did not follow for a year. The positive
    // half, file-scoped because it is asserting the call, not the copy.
    expect(settingsPage).toMatch(
      /background: signetDarkTokens\.color\.surface\.card/,
    );
  });

  it("no longer defers the chapter palette to the chunk it is in", () => {
    expect(description).not.toMatch(/Chunk 07/);
  });

  it("carries no em dash, because it is greenfield product copy", () => {
    // `spec/ui/web-greenfield/README.md` §2.
    expect(description).not.toContain("\u2014");
  });
});

describe("the three things the copy promises never change", () => {
  /*
   * The copy is the product-facing half of the no-retint lock, and a promise in
   * a card is worth exactly as much as the thing enforcing it. The structural
   * half lives in `packages/theme/src/signet.css.spec.ts`; this asserts the
   * connection, so deleting that guard cannot leave the sentence standing alone.
   */
  const applied = Object.keys(
    signetAccentSemanticVars(deriveSignetPalette("#9B4DD6").palette),
  );

  it("the mark: nothing the bridge writes can reach a raster", () => {
    // `signet-mark.tsx` paints `/brand/signet-emblem-B.png` over a local
    // `#1A1A1A` literal, and `crest-page.tsx` the same file at 260px. Neither
    // reads a token, and `check-brand-assets.mjs` reads the pixels.
    expect(applied.some((token) => token.includes("mark"))).toBe(false);
    expect(applied.some((token) => token.includes("gold"))).toBe(false);
  });

  it("the Ask pill: --gold-ask-* is not in the bridge's output", () => {
    // `tokens.md` L-01 names the merge trap: the board's Ask family and its
    // accent family are identical *only* because its demo tenant is the house
    // tenant. Merging them on that evidence breaks every other chapter.
    for (const token of [
      "--gold-ask-fill",
      "--gold-ask-border",
      "--gold-ask-text",
    ]) {
      expect(applied).not.toContain(token);
    }
  });

  it("the scrollbars: --scrollbar-* is not in the bridge's output", () => {
    for (const token of [
      "--scrollbar-thumb",
      "--scrollbar-thumb-hover",
      "--scrollbar-track",
    ]) {
      expect(applied).not.toContain(token);
    }
  });

  it("while the surfaces the copy does claim are reachable", () => {
    // The positive case, so the block reads in both directions: the sentence
    // names three surfaces that DO move, and all three are painted from these.
    expect(applied).toEqual(
      expect.arrayContaining([
        "--primary",
        "--primary-foreground",
        "--accent-subtle",
        "--accent-text",
      ]),
    );
  });

  it("and selected text, which it no longer claims, is not", () => {
    // `::selection` is neutral on purpose (signet.css). The copy said otherwise
    // for one draft; this is the assertion that keeps the two in step.
    expect(description).not.toMatch(/selected text/);
    expect(applied).not.toContain("--foreground");
  });
});

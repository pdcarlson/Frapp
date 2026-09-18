import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the landing page's rebuild (#2367) against the two ways it is likely
 * to rot: a marketing copy rule quietly broken by a later edit, and the motion
 * numbers in `globals.css` drifting away from the scale they mirror.
 *
 * Source-reading, in the style of `app/privacy/page.spec.ts`, because
 * `apps/landing` has no DOM test environment and adding one to assert static
 * copy would be a heavier dependency than the thing it checks.
 */

// `vitest run` in this workspace uses the package directory as cwd.
const landingRoot = process.cwd();
const repoRoot = join(landingRoot, "..", "..");

const pageSource = readFileSync(join(landingRoot, "app/page.tsx"), "utf8");
const globalsSource = readFileSync(join(landingRoot, "app/globals.css"), "utf8");
const layoutSource = readFileSync(join(landingRoot, "app/layout.tsx"), "utf8");

/**
 * Copy rules bind rendered strings, not repository prose, and the comments in
 * `page.tsx` are prose that keeps the house style. Stripping them is what lets
 * the em-dash rule be asserted over the whole remaining file instead of over a
 * hand-maintained list of string literals.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** JSX wraps a sentence across lines, so copy is matched on one flat line. */
function flatten(source: string): string {
  return withoutComments(source).replace(/\s+/g, " ");
}

const renderedPage = withoutComments(pageSource);
const flatPage = flatten(pageSource);
const renderedLayout = withoutComments(layoutSource);

describe("landing marketing copy rules", () => {
  it("uses no em dashes in rendered copy", () => {
    // `spec/ui/landing/README.md` § Marketing copy rules. No CI check enforced
    // this before; it was a review rule and reviews miss one.
    expect(renderedPage).not.toContain("—");
    expect(withoutComments(layoutSource)).not.toContain("—");
  });

  it("says Check in and never RSVP", () => {
    // `spec/behavior/events.md`: pre-event RSVP intent is not modelled, so a
    // control for it would draw a product that does not exist.
    expect(renderedPage).not.toMatch(/RSVP/i);
    expect(renderedPage).not.toMatch(/\bgoing\b/i);
    expect(renderedPage).not.toMatch(/can.?t make it/i);
    expect(renderedPage).toContain("Check in");
  });

  it("ships no Ask control and no machine that answers", () => {
    // `spec/behavior/ai.md`: no shipped surface can answer a question, and the
    // web Ask pill opens an "isn't ready" notice.
    expect(renderedPage).not.toMatch(/\bAsk\b/);
    expect(renderedPage).not.toMatch(/\bAI\b/);
    expect(renderedPage).not.toMatch(/assistant/i);
  });

  it("keeps the locked tagline in the title and out of the page body", () => {
    // D8. Scope is the body only; `brand-identity.md` §1 still locks it as the
    // brand tagline, which is what a title tag carries.
    expect(renderedPage).not.toContain("Ask your chapter anything");
    expect(layoutSource).toContain("Signet. Ask your chapter anything.");
    expect(renderedPage).toContain(
      "Everything your chapter needs is already in chat.",
    );
  });

  it("carries no figure that is not a commitment", () => {
    expect(renderedPage).toContain("$0");
    expect(renderedPage).toContain("$149");
    expect(renderedPage).toContain("14 days");
    expect(renderedPage).toContain("day 15");
    // The unsourced strip that used to run under the hero.
    expect(renderedPage).not.toContain("50+");
    expect(renderedPage).not.toContain("2,000+");
    expect(renderedPage).not.toContain("10,000+");
    expect(renderedPage).not.toMatch(/five minutes/i);
  });

  it("drops the ops-consolidation positioning everywhere it was stated", () => {
    for (const source of [renderedPage, renderedLayout]) {
      expect(source).not.toContain("Discord");
      expect(source).not.toContain("OmegaFi");
      expect(source).not.toContain("Life360");
      expect(source).not.toMatch(/operating system for greek life/i);
    }
  });

  it("names events, check-in and points in the chat sentence, and not dues", () => {
    // `spec/behavior/chat/integrations.md` lists the dues chat kind as a stub
    // renderer, so no dues artifact may be claimed to land in the thread.
    expect(flatPage).toContain(
      "Events, check-in and points land in the conversation",
    );
    expect(renderedPage).not.toMatch(/dues[^.]{0,40}(in|into) (the )?(chat|thread|conversation)/i);
  });

  it("carries no testimonial, no FAQ and no stats array", () => {
    for (const name of ["testimonials", "faqs", "chapterStats", "features"]) {
      expect(renderedPage).not.toMatch(new RegExp(`const ${name}\\b`));
    }
  });

  it("wraps every frame in a labelled role=img and captions it as demo data", () => {
    // Three frames render from two components: `ChatFrame` is used twice, at
    // the fold and in the chat proof section, so the source carries two
    // `role="img"` attributes and three call sites.
    expect(renderedPage.match(/role="img"/g) ?? []).toHaveLength(2);
    expect(renderedPage.match(/<ChatFrame\b/g) ?? []).toHaveLength(2);
    expect(renderedPage.match(/<EventFrame\b/g) ?? []).toHaveLength(1);
    // Every `role="img"` carries an `aria-label`, or it announces nothing.
    expect(renderedPage.match(/aria-label=/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(
      flatPage.match(/Names and (messages|events) are illustrative/g) ?? [],
    ).toHaveLength(3);
  });
});

describe("landing page structure", () => {
  it("opens with a skip link into the main landmark", () => {
    expect(renderedPage).toContain("Skip to content");
    expect(renderedPage).toMatch(/href="#top"/);
    expect(renderedPage).toMatch(/<main id="top"/);
  });

  it("keeps the anchors the nav, the footer and positioning.md point at", () => {
    // `spec/product/positioning.md` cites the pricing section by its id.
    expect(renderedPage).toContain('id="product"');
    expect(renderedPage).toContain('id="pricing"');
  });

  it("renders no image request, so the H1 stays the LCP element", () => {
    // `spec/ui/landing/README.md` § Performance. The crest is an inline path
    // and both product frames are JSX.
    expect(pageSource).not.toMatch(/from ["']next\/image["']/);
    expect(renderedPage).not.toContain("showcase-dashboard");
    expect(renderedPage).not.toContain("showcase-mobile");
  });

  it("gives the hero H1, lead and primary CTA no entrance animation", () => {
    const hero = renderedPage.slice(
      renderedPage.indexOf("<main"),
      renderedPage.indexOf("Built for officers"),
    );
    expect(hero).toContain("Run your chapter where it already talks.");
    expect(hero).not.toContain("RevealOnView");
    expect(hero).not.toContain("reveal-item");
  });

  it("routes every tracked control through the auth URL builders", () => {
    // The Spec sheet's §5 routes contract, one assertion per row.
    for (const [cta, surface] of [
      ["get-started", "header"],
      ["log-in", "header"],
      ["get-started", "hero"],
      ["join-chapter", "hero"],
      ["get-started", "pricing"],
      ["get-started", "cta-band"],
      ["log-in", "cta-band"],
      ["log-in", "footer"],
    ]) {
      expect(
        renderedPage,
        `no TrackedCta for ${cta} on ${surface}`,
      ).toMatch(new RegExp(`cta="${cta}"\\s*\\n?\\s*surface="${surface}"`));
    }
    expect(pageSource).toContain("buildAuthUrls");
    // The invite CTA targets this origin's `/join`, which calls `buildJoinUrl`
    // itself rather than moving that helper's throw onto the homepage.
    expect(renderedPage).toContain('const joinUrl = "/join"');
  });

  it("puts one control in the pricing section, on the Free card", () => {
    const pricing = renderedPage.slice(
      renderedPage.indexOf('id="pricing"'),
      renderedPage.indexOf("Everything your chapter needs"),
    );
    expect(pricing.match(/surface="pricing"/g) ?? []).toHaveLength(1);
    expect(pricing).toContain("Upgrade any time from Settings inside the app.");
  });
});

describe("landing motion stylesheet", () => {
  /**
   * The durations and easings in `globals.css` are a CSS mirror of the JS
   * motion scale. `packages/theme/src/tokens.ts` is not a package export and
   * the scale has no CSS form, so the values are restated; this is what stops
   * the restatement from becoming a second scale.
   */
  const tokensSource = readFileSync(
    join(repoRoot, "packages/theme/src/tokens.ts"),
    "utf8",
  );

  function jsNumber(name: string): number {
    const match = new RegExp(`${name}:\\s*(\\d+)`).exec(tokensSource);
    if (!match) throw new Error(`motion.duration.${name} not found in tokens.ts`);
    return Number(match[1]);
  }

  function cssMs(name: string): number {
    const match = new RegExp(`--${name}:\\s*(\\d+)ms`).exec(globalsSource);
    if (!match) throw new Error(`--${name} not found in globals.css`);
    return Number(match[1]);
  }

  it("mirrors the motion durations from tokens.ts", () => {
    expect(cssMs("motion-micro")).toBe(jsNumber("micro"));
    expect(cssMs("motion-standard")).toBe(jsNumber("standard"));
    expect(cssMs("motion-context")).toBe(jsNumber("context"));
  });

  it("mirrors the easing curves from tokens.ts", () => {
    const normalize = (value: string) => value.replace(/\s+/g, "");
    for (const [cssName, jsName] of [
      ["motion-ease-standard", "standard"],
      ["motion-ease-entrance", "entrance"],
    ]) {
      const css = new RegExp(`--${cssName}:\\s*([^;]+);`).exec(globalsSource)?.[1];
      const js = new RegExp(`${jsName}:\\s*"([^"]+)"`).exec(tokensSource)?.[1];
      expect(css, `--${cssName} missing from globals.css`).toBeDefined();
      expect(js, `motion.easing.${jsName} missing from tokens.ts`).toBeDefined();
      expect(normalize(css ?? "")).toBe(normalize(js ?? "unmatched"));
    }
  });

  it("stays inside the 300ms context ceiling for section entrances", () => {
    // `spec/ui/design-system/README.md` §7 motion budget. Nothing below the
    // fold may run longer than the context duration.
    const overLongs = globalsSource.match(/\b([4-9]\d{2}|\d{4,})ms\b/g) ?? [];
    expect(overLongs).toEqual([]);
  });

  it("does not claim a fourth motion class without the amendment that pays for it", () => {
    /*
     * D4's signature moment is cut until brand sign-off clears (#2378). If a
     * later change reintroduces it, the taxonomy amendment has to land in the
     * SAME pull request, never earlier and never later, per
     * `spec/ui/landing/README.md` § Motion, and what D4 still owes. This test
     * is what makes "the same PR" mechanical rather than remembered.
     */
    // Matches what the signature class would actually declare, not the word:
    // the comment above these rules explains at length why it is absent.
    const declaresSignature =
      /--motion-signature|@keyframes\s+signet-|animation:\s*signet-/.test(
        globalsSource,
      );
    if (!declaresSignature) {
      expect(globalsSource).not.toMatch(/@keyframes\s+signet-(wipe|settle|bloom)/);
      return;
    }
    const designSystemReadme = readFileSync(
      join(repoRoot, "spec/ui/design-system/README.md"),
      "utf8",
    );
    const foundations = readFileSync(
      join(repoRoot, "spec/ui/design-system/foundations.md"),
      "utf8",
    );
    expect(
      designSystemReadme,
      "README §7's motion table needs the signature row in this PR",
    ).toMatch(/signature/i);
    expect(
      foundations,
      "foundations §11 needs the signature paragraph in this PR",
    ).toMatch(/signature/i);
  });

  it("draws every reveal at rest under reduced motion", () => {
    // The hidden state lives inside the no-preference query, so a reduced
    // motion user never has content hidden that something else must un-hide.
    const noPreference = /@media \(prefers-reduced-motion: no-preference\)\s*\{/.exec(
      globalsSource,
    );
    expect(noPreference).not.toBeNull();
    const hiddenState = globalsSource.indexOf(".reveal-armed .reveal-item");
    expect(hiddenState).toBeGreaterThan(noPreference!.index);
  });
});

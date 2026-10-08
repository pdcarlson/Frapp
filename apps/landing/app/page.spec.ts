import { readdirSync, readFileSync } from "node:fs";
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

/*
 * `page.tsx` composes the sections; each section and both product frames live
 * in `components/home/`, one file apiece (#3274). The copy rules bind every one
 * of them, so the directory is read whole rather than listed here: a section
 * added later is covered without anyone remembering to add it.
 */
const homeDir = join(landingRoot, "components/home");
const homeSources = Object.fromEntries(
  readdirSync(homeDir)
    .filter((file) => /\.tsx?$/.test(file) && !/\.spec\.tsx?$/.test(file))
    .sort()
    .map((file) => [file, readFileSync(join(homeDir, file), "utf8")]),
);

function homeSource(file: string): string {
  const source = homeSources[file];
  if (source === undefined) throw new Error(`components/home/${file} is gone`);
  return source;
}

const allSources = [pageSource, ...Object.values(homeSources)].join("\n");
const globalsSource = readFileSync(join(landingRoot, "app/globals.css"), "utf8");
const layoutSource = readFileSync(join(landingRoot, "app/layout.tsx"), "utf8");

/**
 * Copy rules bind rendered strings, not repository prose, and the comments in
 * `page.tsx` and its sections are prose that keeps the house style. Stripping them is what lets
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
const renderedAll = withoutComments(allSources);
const flatAll = flatten(allSources);
const renderedLayout = withoutComments(layoutSource);

describe("landing marketing copy rules", () => {
  it("uses no em dashes in rendered copy", () => {
    // `spec/ui/landing/README.md` § Marketing copy rules. No CI check enforced
    // this before; it was a review rule and reviews miss one.
    expect(renderedAll).not.toContain("—");
    expect(withoutComments(layoutSource)).not.toContain("—");
  });

  it("says Check in and never RSVP", () => {
    // `spec/behavior/events.md`: pre-event RSVP intent is not modelled, so a
    // control for it would draw a product that does not exist.
    expect(renderedAll).not.toMatch(/RSVP/i);
    expect(renderedAll).not.toMatch(/\bgoing\b/i);
    expect(renderedAll).not.toMatch(/can.?t make it/i);
    expect(renderedAll).toContain("Check in");
  });

  it("ships no Ask control and no machine that answers", () => {
    // `spec/behavior/ai.md`: no shipped surface can answer a question, and the
    // web Ask pill opens an "isn't ready" notice.
    expect(renderedAll).not.toMatch(/\bAsk\b/);
    expect(renderedAll).not.toMatch(/\bAI\b/);
    expect(renderedAll).not.toMatch(/assistant/i);
  });

  it("keeps the locked tagline in the title and out of the page body", () => {
    // D8. Scope is the body only; `brand-identity.md` §1 still locks it as the
    // brand tagline, which is what a title tag carries.
    expect(renderedAll).not.toContain("Ask your chapter anything");
    expect(layoutSource).toContain("Frapp. Ask your chapter anything.");
    expect(renderedAll).toContain(
      "Everything your chapter needs is already in chat.",
    );
  });

  it("carries no figure that is not a commitment", () => {
    expect(renderedAll).toContain("$0");
    expect(renderedAll).toContain("$149");
    expect(renderedAll).toContain("14 days");
    expect(renderedAll).toContain("day 15");
    // The unsourced strip that used to run under the hero.
    expect(renderedAll).not.toContain("50+");
    expect(renderedAll).not.toContain("2,000+");
    expect(renderedAll).not.toContain("10,000+");
    expect(renderedAll).not.toMatch(/five minutes/i);
  });

  it("drops the ops-consolidation positioning everywhere it was stated", () => {
    for (const source of [renderedAll, renderedLayout]) {
      expect(source).not.toContain("Discord");
      expect(source).not.toContain("OmegaFi");
      expect(source).not.toContain("Life360");
      expect(source).not.toMatch(/operating system for greek life/i);
    }
  });

  it("names events, check-in and points in the chat sentence, and not dues", () => {
    // `spec/behavior/chat/integrations.md` lists the dues chat kind as a stub
    // renderer, so no dues artifact may be claimed to land in the thread.
    expect(flatAll).toContain(
      "Events, check-in and points land in the conversation",
    );
    expect(renderedAll).not.toMatch(/dues[^.]{0,40}(in|into) (the )?(chat|thread|conversation)/i);
  });

  it("carries no testimonial, no FAQ and no stats array", () => {
    for (const name of ["testimonials", "faqs", "chapterStats", "features"]) {
      expect(renderedAll).not.toMatch(new RegExp(`const ${name}\\b`));
    }
  });

  it("wraps every frame in a labelled role=img and captions it as demo data", () => {
    // Three frames render from two components: `ChatFrame` is used twice, at
    // the fold and in the chat proof section, so the source carries two
    // `role="img"` attributes and three call sites.
    expect(renderedAll.match(/role="img"/g) ?? []).toHaveLength(2);
    expect(renderedAll.match(/<ChatFrame\b/g) ?? []).toHaveLength(2);
    expect(renderedAll.match(/<EventFrame\b/g) ?? []).toHaveLength(1);
    // Every `role="img"` carries an `aria-label`, or it announces nothing. The
    // pairing is what makes this bite: counting `aria-label=` anywhere in the
    // file passed on the nav and the lockup alone, so a frame could lose its
    // label and the assertion would not notice.
    expect(renderedAll.match(/role="img"\s+aria-label=/g) ?? []).toHaveLength(2);
    expect(
      flatAll.match(/Names and (messages|events) are illustrative/g) ?? [],
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
    expect(renderedAll).toContain('id="product"');
    expect(renderedAll).toContain('id="pricing"');
  });

  it("renders no image request, so the H1 stays the LCP element", () => {
    // `spec/ui/landing/README.md` § Performance. The crest is an inline path
    // and both product frames are JSX.
    expect(allSources).not.toMatch(/from ["']next\/image["']/);
    expect(renderedAll).not.toContain("showcase-dashboard");
    expect(renderedAll).not.toContain("showcase-mobile");
  });

  it("gives the hero H1, lead and primary CTA no entrance animation", () => {
    // The hero is the first thing inside `main`.
    const main = renderedPage.slice(renderedPage.indexOf("<main"));
    expect(main.indexOf("<HeroSection")).toBeGreaterThan(-1);
    expect(main.indexOf("<HeroSection")).toBeLessThan(main.indexOf("<OfficersSection"));
    const hero = withoutComments(homeSource("hero-section.tsx"));
    expect(hero).toContain("Run your chapter where it already talks.");
    expect(hero).not.toContain("RevealOnView");
    expect(hero).not.toContain("reveal-item");
  });

  it("leads the events section with its copy, and keeps the frame left on desktop", () => {
    // The phone board orders the section copy-first and the desktop board puts
    // the frame on the left. Collapsing to one column in DOM order would have
    // shown a 560px mockup before the heading that names it.
    const events = withoutComments(homeSource("events-proof-section.tsx"));
    expect(events.indexOf("Check-in that keeps its own books.")).toBeLessThan(
      events.indexOf("<EventFrame"),
    );
    // Desktop puts it back on the left without disturbing that source order.
    expect(events).toMatch(/lg:col-start-1[^"]*lg:row-start-1|lg:row-start-1[^"]*lg:col-start-1/);
  });

  it("gives the event frame the phone board's geometry as its base", () => {
    // 350x560 at radius 28 with 44/16 insets, overridden at `sm` to the desktop
    // board's 390x600 at radius 36 with 56/20. Varying only the width shipped a
    // phone frame at the desktop's height and cropped different content.
    const frame = withoutComments(homeSource("event-frame.tsx"));
    expect(frame).toContain("function EventFrame");
    for (const base of ["h-[560px]", "w-[350px]", "rounded-[28px]", "px-4", "pt-11"]) {
      expect(frame, `event frame is missing the phone base ${base}`).toContain(base);
    }
    for (const up of [
      "sm:h-[600px]",
      "sm:w-[390px]",
      "sm:rounded-[36px]",
      "sm:px-5",
      "sm:pt-14",
    ]) {
      expect(frame, `event frame is missing the desktop override ${up}`).toContain(up);
    }
  });

  describe("the chat thread draws chat's compact layout, not the retired bubbles", () => {
    // `components.md` § Chat messages (#2873): chat has had no bubbles on web
    // or mobile since 2026-09-29, so the frame that pictures it can't draw any
    // (#2893). Each case pins one rule of that section, positively where it
    // can, because "no radius 18" alone lets a bubble back at any other radius.
    const chatFrame = withoutComments(homeSource("chat-frame.tsx"));
    const start = chatFrame.indexOf("const threadRows");
    const end = chatFrame.indexOf("function Composer");
    const thread = chatFrame.slice(start, end);

    it("finds the thread", () => {
      expect(start, "the chat thread's row list moved").toBeGreaterThanOrEqual(0);
      expect(end, "the composer moved").toBeGreaterThan(start);
    });

    it("starts every row as a run, under an author line that carries the time only", () => {
      const rowCount = (thread.match(/\{ key: "[^"]+", kind:/g) ?? []).length;
      const runs = thread.match(/<RunStart\b[^>]*>/g) ?? [];
      expect(rowCount).toBeGreaterThan(0);
      expect(runs).toHaveLength(rowCount);
      for (const run of runs) {
        // `formatTimeOfDay`'s shape: never a date, never a "read" marker.
        expect(run, "an author line carries something besides the time").toMatch(
          /\btime="\d{1,2}:\d{2} [AP]M"/,
        );
      }
      expect(thread).not.toMatch(/·\s*read\b/i);
      // And `RunStart`'s author line is the name then that prop, and nothing
      // else, so a date can't come back inside the component either.
      expect(thread).toMatch(
        /<p className="[^"]*">\s*<span\s+className=\{`[^`]*`\}\s*>\s*\{author\}\s*<\/span>\s*<span className="[^"]*\btext-muted-foreground\b[^"]*">\{time\}<\/span>\s*<\/p>/,
      );
    });

    it("labels the viewer's own run \"You\" in the accent text, on the left", () => {
      expect(thread.match(/<RunStart\b[^>]*\bauthor="You"[^>]*\bself\b/g) ?? []).toHaveLength(1);
      expect(thread).toMatch(/self \? "text-accent-text" : "text-foreground"/);
      // Own messages sit on the left like everyone else's: nothing pushes a
      // row, or its body, to the right edge.
      expect(thread).not.toMatch(/\b(?:ml-auto|self-end|items-end|flex-row-reverse|text-right)\b/);
    });

    it("draws message text with no fill, border or padding", () => {
      const body = /const BODY =\s*"([^"]+)"/.exec(thread)?.[1];
      expect(body, "BODY moved").toBeDefined();
      expect(body).not.toMatch(/\b(?:bg|border|rounded|shadow|p[xytrbl]?)-/);
      expect(thread.match(/<p className=\{BODY\}>/g) ?? []).toHaveLength(3);
      // Every fill, border, radius, ring and shadow the thread draws, counted:
      // the avatar's circle, the event card (fill, hairline, radius 14), the
      // Check in control and the mention chip, once each. A bubble wrapped
      // round a body, or a retinted row, adds a token or a count this doesn't
      // allow, whichever spelling it uses (`rounded`, `border-[1px]`,
      // `border-l-2`, `ring-1`).
      const visual = (thread.match(
        /(?<![\w-])(?:bg|border|rounded|ring|shadow|outline|divide)(?:-[\w[\].%/-]+)?/g,
      ) ?? []).reduce<Record<string, number>>(
        (counts, token) => ({ ...counts, [token]: (counts[token] ?? 0) + 1 }),
        {},
      );
      expect(visual).toEqual({
        "bg-popover": 1,
        "bg-card": 1,
        "bg-primary": 1,
        "bg-mention-chip": 1,
        "rounded-full": 1,
        "rounded-lg": 1,
        "rounded-sm": 1,
        "rounded-[5px]": 1,
        border: 1,
        "border-border": 1,
      });
      expect(thread).not.toMatch(/bubble/i);
    });

    it("puts the in-body mention chip on the handle alone", () => {
      expect(thread).toMatch(
        /className="[^"]*\bbg-mention-chip\b[^"]*\btext-mention-chip-text\b[^"]*"\s*>\s*@\w+\s*</,
      );
    });
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
        renderedAll,
        `no TrackedCta for ${cta} on ${surface}`,
      ).toMatch(new RegExp(`cta="${cta}"\\s*\\n?\\s*surface="${surface}"`));
    }
    expect(pageSource).toContain("buildAuthUrls");
    // The invite CTA targets this origin's `/join`, which calls `buildJoinUrl`
    // itself rather than moving that helper's throw onto the homepage.
    expect(renderedPage).toContain('const joinUrl = "/join"');
  });

  it("puts one control in the pricing section, on the Free card", () => {
    const pricing = withoutComments(homeSource("pricing-section.tsx"));
    expect(pricing).toContain('id="pricing"');
    expect(pricing.match(/surface="pricing"/g) ?? []).toHaveLength(1);
    expect(pricing).toContain("Upgrade any time from Settings inside the app.");
  });
});

describe("landing motion stylesheet", () => {
  /**
   * The durations and easings in `globals.css` are a CSS mirror of the JS
   * motion scale. `packages/theme/src/motion.ts` is not a package export and
   * the scale has no CSS form, so the values are restated; this is what stops
   * the restatement from becoming a second scale.
   */
  const tokensSource = readFileSync(
    join(repoRoot, "packages/theme/src/motion.ts"),
    "utf8",
  );

  function jsNumber(name: string): number {
    const match = new RegExp(`${name}:\\s*(\\d+)`).exec(tokensSource);
    if (!match) throw new Error(`motion.duration.${name} not found in motion.ts`);
    return Number(match[1]);
  }

  function cssMs(name: string): number {
    const match = new RegExp(`--${name}:\\s*(\\d+)ms`).exec(globalsSource);
    if (!match) throw new Error(`--${name} not found in globals.css`);
    return Number(match[1]);
  }

  it("mirrors the motion durations from motion.ts", () => {
    expect(cssMs("motion-micro")).toBe(jsNumber("micro"));
    expect(cssMs("motion-standard")).toBe(jsNumber("standard"));
    expect(cssMs("motion-context")).toBe(jsNumber("context"));
  });

  it("mirrors the easing curves from motion.ts", () => {
    const normalize = (value: string) => value.replace(/\s+/g, "");
    for (const [cssName, jsName] of [
      ["motion-ease-standard", "standard"],
      ["motion-ease-entrance", "entrance"],
    ]) {
      const css = new RegExp(`--${cssName}:\\s*([^;]+);`).exec(globalsSource)?.[1];
      const js = new RegExp(`${jsName}:\\s*"([^"]+)"`).exec(tokensSource)?.[1];
      expect(css, `--${cssName} missing from globals.css`).toBeDefined();
      expect(js, `motion.easing.${jsName} missing from motion.ts`).toBeDefined();
      expect(normalize(css ?? "")).toBe(normalize(js ?? "unmatched"));
    }
  });

  it("stays inside the 300ms context ceiling for section entrances", () => {
    // `spec/ui/design-system/README.md` §7 motion budget. Nothing below the
    // fold may run longer than the context duration.
    const overLongs = globalsSource.match(/\b([4-9]\d{2}|\d{4,})ms\b/g) ?? [];
    expect(overLongs).toEqual([]);
  });

  it("keeps every gesture inside the context ceiling, iterations included", () => {
    /*
     * The duration guard above reads LITERAL `NNNms` tokens, so it cannot see
     * the two ways a gesture gets long without writing a long number: an
     * iteration count, and a delay. `animation: x var(--motion-context) ... 2`
     * runs for twice the ceiling while declaring nothing over 300.
     *
     * That is not hypothetical — it is the shape slice 3 rejected when it built
     * the check-in ring, and #2387 tells whoever builds the typing row that this
     * file enforces the rule. So it has to actually enforce it.
     *
     * `infinite` fails outright: the Motion sheet opens "Nothing loops on the
     * page." The skeleton shimmer that does loop lives in `@repo/theme`'s
     * stylesheet, not this one, and is out of this file's scope.
     */
    const ceiling = cssMs("motion-context");
    const durations = new Map<string, number>();
    for (const match of globalsSource.matchAll(/--(motion-[a-z-]+):\s*(\d+)ms/g)) {
      durations.set(String(match[1]), Number(match[2]));
    }

    const offenders: string[] = [];
    for (const match of globalsSource.matchAll(/animation:\s*([^;]+);/g)) {
      const decl = String(match[1]).replace(/\s+/g, " ").trim();
      // `animation: none` is the print branch cancelling a reveal, not a gesture.
      if (decl === "none") continue;

      const named = /var\(--(motion-[a-z-]+)\)/.exec(decl)?.[1];
      const literal = /\b(\d+)ms\b/.exec(decl)?.[1];
      const duration = named ? durations.get(named) : literal ? Number(literal) : undefined;
      if (duration === undefined) {
        offenders.push(`${decl} — no duration this test can resolve`);
        continue;
      }

      // Strip `var(...)` and `NNNms` so what is left of the shorthand can be
      // scanned for a bare iteration count.
      const rest = decl.replace(/var\([^)]*\)/g, " ").replace(/\b\d+ms\b/g, " ");
      if (/\binfinite\b/.test(rest)) {
        offenders.push(`${decl} — loops, and nothing on this page may loop`);
        continue;
      }
      const iterations = Number(/\b(\d+)\b/.exec(rest)?.[1] ?? 1);
      const total = duration * iterations;
      if (total > ceiling) {
        offenders.push(
          `${decl} — ${duration}ms x ${iterations} runs past the ${ceiling}ms ceiling`,
        );
      }
    }

    expect(
      offenders,
      "a gesture runs longer than the context duration `spec/ui/design-system/README.md` §7 sets " +
        "as the ceiling. Declaring no single number over the limit does not make it shorter; a " +
        "gesture that needs longer is the Motion sheet's signature class, and that class needs the " +
        "taxonomy amendment #2378 is blocked on, in the same pull request.",
    ).toEqual([]);
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

  it("never arms a block the browser has already painted", () => {
    /*
     * Arming sets `opacity: 0` and the observer's first callback is async, so
     * arming something already on screen is a visible disappear-and-replay. It
     * is reachable by a direct `/#pricing` load, a restored scroll position, or
     * a scroll that beats hydration. The wrapper measures first.
     */
    const wrapper = readFileSync(
      join(landingRoot, "components/reveal-on-view.tsx"),
      "utf8",
    );
    const guard = wrapper.indexOf("getBoundingClientRect");
    const arm = wrapper.indexOf('classList.add("reveal-armed")');
    expect(guard, "the wrapper must measure before it arms").toBeGreaterThan(-1);
    expect(guard).toBeLessThan(arm);
    expect(wrapper).toMatch(
      /getBoundingClientRect\(\)\.top\s*<\s*window\.innerHeight\)\s*return;/,
    );
  });

  it("draws every reveal at rest when printing", () => {
    // A printed page never scrolls and runs no observer, so an armed block that
    // was never reached has nothing to clear it and would go to paper blank.
    expect(globalsSource).toMatch(/@media print\s*\{/);
    const print = globalsSource.slice(globalsSource.indexOf("@media print"));
    expect(print).toContain(".reveal-armed .reveal-item");
    expect(print).toContain(".reveal-armed .reveal-rule");
  });

  it("draws every reveal at rest under reduced motion", () => {
    // The hidden state lives inside the no-preference query, so a reduced
    // motion user never has content hidden that something else must un-hide.
    const noPreference = /@media \(prefers-reduced-motion: no-preference\)\s*\{/.exec(
      globalsSource,
    );
    expect(noPreference).not.toBeNull();

    /*
     * Walk to the query's matching close, so this asserts CONTAINMENT rather
     * than "appears somewhere after". Comparing offsets would have stayed green
     * if the hidden state were moved out of the query to anywhere below it,
     * which is precisely the regression that would hide content from a reduced
     * motion reader.
     */
    const open = noPreference!.index + noPreference![0].length;
    let depth = 1;
    let cursor = open;
    while (depth > 0 && cursor < globalsSource.length) {
      const char = globalsSource[cursor++];
      if (char === "{") depth++;
      else if (char === "}") depth--;
    }
    expect(
      globalsSource.slice(open, cursor - 1),
      "the reveal hidden state must sit inside the no-preference query",
    ).toMatch(/\.reveal-armed \.reveal-item\s*\{[^}]*opacity:\s*0/);
  });
});

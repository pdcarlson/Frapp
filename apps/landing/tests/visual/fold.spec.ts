import { expect, test } from "@playwright/test";

/**
 * The reskin's fold, asserted rather than eyeballed.
 *
 * `spec/ui/landing/reference/canvas/HeroB.dc.html` draws the shipping fold at
 * 1440x900 and `Phone.dc.html` draws the page at 390 (decision D6); those two
 * viewports are what the boards commit to, so they are what checks 1 to 5
 * measure. Check 6 is about the two chat frames rather than the fold, and
 * sweeps the widths in its own loop, 320 to 1440. The event frame is not in
 * it: its height is the phone board's, fixed on purpose.
 *
 * **This is deliberately not a screenshot test**, and that is the repo's
 * position rather than a shortcut. The advisory snapshot suite that
 * photographed routes and diffed committed PNGs was deleted: baselines pinned
 * to CI's Chromium build drifted with every Playwright bump, so the red X was
 * usually answered by regenerating the fixture.
 * `.claude/skills/testing/SKILL.md` records the rule that came out of it —
 * "**Never re-add an `--update-snapshots` step to a checklist** — there are no
 * baselines to update" — and `docs/ci-cd/quality-gates.md` says pixel
 * coverage belongs in a hosted service with per-PR baseline review, not in the
 * repo. So this suite stores no baseline and compares no pixels. It reads
 * numbers off the rendered page, which cannot go stale and needs no
 * regeneration ritual when the page legitimately changes.
 *
 * What it covers is the set of fold properties slice 2 verified by hand and
 * nothing then held in place (checks 1 to 5), plus the chat frames' fit, which
 * #2893 added (check 6):
 *
 *  1. Neither board width opens a horizontal scrollbar. The fold's chat frame
 *     deliberately overruns its column at `lg` and is clipped by the section's
 *     `overflow-hidden`; drop that clip and this goes red.
 *  2. The H1 and the hero's own primary CTA are wholly inside the fold, at both
 *     widths. They are the offer and the action, and a fold that pushes either
 *     out is the composition breaking.
 *  3. The officers strip starts inside the 1440x900 fold. That is the whole
 *     point of D9: hero B replaced the crest column with the chat frame, which
 *     is what pulled "Built for officers" up into the fold. The Spec sheet's
 *     section map states it as a requirement of that row.
 *  4. A scroll that JUMPS past the reveals still finishes every one. This is
 *     what the wrapper's enormous top `rootMargin` buys: an observer only
 *     queues an entry when a target crosses a threshold, so a block skipped
 *     over in one step is never delivered one and stays at `opacity: 0` with
 *     nothing left to clear it.
 *  5. Under `prefers-reduced-motion: reduce`, nothing is armed and nothing is
 *     part-way through an entrance. `app/page.spec.ts` asserts the hidden state
 *     SITS INSIDE the no-preference query by reading the stylesheet; this
 *     asserts the browser agrees, which is a different failure surface.
 *  6. Neither chat frame crops its thread, at any width from a small phone up.
 *     Each frame's height is a minimum that grows when its rows need more, so
 *     every row is whole and the composer sits under the newest one, inside
 *     the frame, and its header row fits without clipping. Each frame also
 *     fits inside its section's content box, except the fold's from `lg` up,
 *     which bleeds off the right edge on purpose. Before #2893 a fixed height
 *     ran the newest rows under the composer at phone width, or pushed the
 *     composer out of the frame.
 *
 * **What was tried and is deliberately NOT here.** An assertion that a direct
 * `/#pricing` load never arms an already-painted block — the flash slice 2 fixed
 * with the measure-before-arm guard — cannot fail in this harness and was
 * removed rather than shipped. Measured against the production build: the
 * browser applies the hash scroll AFTER hydration, so at the moment the wrapper
 * measures, every block is still below the fold and arms legitimately; deleting
 * the guard entirely changes nothing this suite can see. That guard is asserted
 * statically in `app/page.spec.ts` instead, which is where it can be. A gate
 * whose assertion cannot fail is worse than no gate, so it is not here.
 *
 * Every test below was checked the other way round — by breaking the thing it
 * guards and watching it go red.
 */

const FOLDS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

test.describe("the landing fold holds the boards' geometry", () => {
  for (const fold of FOLDS) {
    test(`${fold.name} ${fold.width}x${fold.height} does not scroll horizontally`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: fold.width, height: fold.height });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const measured = await page.evaluate((width) => {
        const doc = document.documentElement;
        const offender = [...document.querySelectorAll("body *")]
          .map((el) => ({ el, rect: el.getBoundingClientRect() }))
          .filter(({ el, rect }) => {
            if (rect.right <= width + 0.5) return false;
            // An element clipped by an ancestor contributes no page overflow.
            for (
              let node: Element | null = el;
              node && node !== document.body;
              node = node.parentElement
            ) {
              const overflowX = getComputedStyle(node).overflowX;
              if (overflowX !== "visible") return false;
            }
            return true;
          })
          .sort((a, b) => b.rect.right - a.rect.right)[0];
        return {
          scrollWidth: doc.scrollWidth,
          widest: offender
            ? {
                right: Math.round(offender.rect.right),
                tag: offender.el.tagName.toLowerCase(),
                className: offender.el.getAttribute("class") ?? "",
              }
            : null,
        };
      }, fold.width);

      expect(
        measured.scrollWidth,
        measured.widest
          ? `the page overflows ${fold.width}px by ${measured.scrollWidth - fold.width}px. The ` +
            `furthest unclipped element is <${measured.widest.tag}> reaching ` +
            `${measured.widest.right}px: class="${measured.widest.className}". The fold frame is ` +
            "supposed to bleed and be CLIPPED by its section's `overflow-hidden`, so check that " +
            "clip first."
          : `the page overflows ${fold.width}px by ${measured.scrollWidth - fold.width}px, but ` +
            "every element is either inside it or clipped by an ancestor, so the cause is the " +
            "shell rather than one box.",
      ).toBeLessThanOrEqual(fold.width);
    });

    test(`${fold.name} ${fold.width}x${fold.height} keeps the offer and the action inside the fold`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: fold.width, height: fold.height });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const hero = page.locator('section[aria-labelledby="hero"]');
      const h1 = hero.getByRole("heading", { level: 1 });
      // Scoped to the hero: "Get started" resolves to four links page-wide, and
      // an unscoped locator is a strict-mode violation rather than a failure.
      const cta = hero.getByRole("link", { name: "Get started" });

      for (const [label, locator] of [
        ["the H1", h1],
        ["the hero's primary CTA", cta],
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${label} did not render`).not.toBeNull();
        expect(
          box!.y + box!.height,
          `${label} runs past the ${fold.height}px fold. The boards put the offer and its one ` +
            "action above it at both widths.",
        ).toBeLessThanOrEqual(fold.height);
      }
    });
  }

  test("the officers strip starts inside the 1440x900 fold (D9)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const officers = page.getByRole("heading", { name: "Built for officers" });
    const box = await officers.boundingBox();
    expect(box, "the officers strip did not render").not.toBeNull();
    expect(
      box!.y,
      "the officers strip begins below the 1440x900 fold. D9 put the chat frame where the crest " +
        "column was precisely so this strip came up into the fold; the Spec sheet's section map " +
        "row 2 states it as a requirement, not a nicety.",
    ).toBeLessThan(900);
  });

  test("a scroll that jumps past the reveals still finishes every one", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // One jump to the bottom, not a smooth scroll. An IntersectionObserver only
    // queues an entry when a target CROSSES a threshold, so a block between the
    // old scroll position and the new one goes from "below, not intersecting"
    // to "above, not intersecting" without ever being inside the root — no
    // entry is delivered and it stays armed at `opacity: 0` forever. The
    // wrapper's enormous TOP rootMargin is what makes "already scrolled past"
    // an intersecting state. Shrink it and this goes red.
    const armed = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.querySelectorAll(".reveal-armed").length;
    });

    // Anti-vacuity, and the reason it is worth its own assertion: under
    // `next dev` NOTHING arms, so every opacity below would be 1 and the test
    // would pass having measured a page whose motion never engaged.
    expect(
      armed,
      "no block armed at all, so this test is not measuring the reveals. That is what `next dev` " +
        "does — the stylesheet arrives after hydration, so every wrapper measures itself inside " +
        "the viewport and takes the measure-before-arm early return. This suite is supposed to " +
        "run against a production build; check the webServer command in playwright.config.ts.",
    ).toBeGreaterThan(0);

    /*
     * Waits for the entrances to FINISH rather than for `is-in` to land. The
     * reveals are staggered (`--i` times `--reveal-step`) on top of a
     * context-duration animation, so every block is legitimately mid-fade for a
     * beat after its class arrives; asserting on the class alone fails on a
     * page that is working correctly.
     */
    const stuck = await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll<HTMLElement>(".reveal-item")].every(
            (el) => Number(getComputedStyle(el).opacity) === 1,
          ),
        undefined,
        { timeout: 5_000 },
      )
      .then(() => [] as string[])
      .catch(async () =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>(".reveal-item")]
            .filter((el) => Number(getComputedStyle(el).opacity) < 1)
            .map((el) => el.getAttribute("class") ?? ""),
        ),
      );

    expect(
      stuck,
      `${stuck.length} block(s) never finished their entrance after a jump to the bottom of the ` +
        "page, so they are stranded at `opacity: 0` with nothing left to clear them. A reveal " +
        "that is skipped over in one scroll step is never delivered an intersection entry — see " +
        "the rootMargin note in components/reveal-on-view.tsx.",
    ).toEqual([]);
  });

  test("every revealable block is drawn at rest under reduced motion", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    try {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const measured = await page.evaluate(() => ({
        armed: document.querySelectorAll(".reveal-armed").length,
        revealItems: document.querySelectorAll(".reveal-item").length,
        hidden: [...document.querySelectorAll<HTMLElement>(".reveal-item")]
          .filter((el) => Number(getComputedStyle(el).opacity) < 1)
          .map((el) => el.getAttribute("class") ?? ""),
      }));

      // Anti-vacuity: with no revealable blocks on the page the opacity
      // assertion below would pass over an empty set and prove nothing.
      expect(
        measured.revealItems,
        "no revealable blocks on the page, so this test is asserting over an empty set",
      ).toBeGreaterThan(0);

      expect(
        measured.armed,
        "a block was armed under reduced motion. The wrapper is supposed to return before it arms " +
          "anything when the reader has asked for less motion, so nothing is ever hidden waiting " +
          "on an entrance that will not play.",
      ).toBe(0);

      expect(
        measured.hidden,
        `${measured.hidden.length} block(s) are part-way through an entrance under reduced motion. ` +
          "Nothing may hide content that an animation has to un-hide.",
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });

  for (const width of [320, 360, 390, 640, 1024, 1440]) {
    test(`at ${width} wide, neither chat frame crops a row or loses its composer`, async ({
      browser,
    }) => {
      // Reduced motion so every row is at rest: a reveal part-way through its
      // rise would be measured a few pixels low.
      const context = await browser.newContext({
        reducedMotion: "reduce",
        viewport: { width, height: 900 },
      });
      const page = await context.newPage();
      try {
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        const frames = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[role="img"]')]
            .filter((frame) => frame.getAttribute("aria-label")?.includes("general channel"))
            .map((frame) => {
              const box = frame.getBoundingClientRect();
              const thread = frame.querySelector(".reveal-item")?.parentElement;
              const composer = thread?.nextElementSibling;
              const header = thread?.previousElementSibling;
              if (!thread || !composer || !header) return { missing: true as const };
              const t = thread.getBoundingClientRect();
              const c = composer.getBoundingClientRect();
              return {
                missing: false as const,
                rows: [...thread.children].map((row) => {
                  const r = row.getBoundingClientRect();
                  return { top: r.top - t.top, bottom: t.bottom - r.bottom };
                }),
                composerBelowThread: c.top - t.bottom,
                composerInsideFrame: box.bottom - c.bottom,
                // Against the section's content box, so a frame running into
                // the shell's side padding counts as well as one past the
                // viewport.
                insideShell: (() => {
                  const section = frame.closest("section");
                  if (!section) return Number.NEGATIVE_INFINITY;
                  const s = section.getBoundingClientRect();
                  const style = getComputedStyle(section);
                  return Math.min(
                    box.left - (s.left + parseFloat(style.paddingLeft)),
                    s.right - parseFloat(style.paddingRight) - box.right,
                  );
                })(),
                headerOverflow: header.scrollWidth - header.clientWidth,
              };
            }),
        );

        // Two frames from one component: the fold's and the chat section's.
        expect(frames, "the chat frames moved or lost their labels").toHaveLength(2);
        for (const [index, frame] of frames.entries()) {
          const name = index === 0 ? "the fold's chat frame" : "the chat section's frame";
          expect(frame.missing, `${name} has no header, thread or composer`).toBe(false);
          if (frame.missing) continue;
          expect(frame.rows.length, `${name} draws no rows`).toBeGreaterThan(0);
          for (const [rowIndex, row] of frame.rows.entries()) {
            expect(
              Math.min(row.top, row.bottom),
              `${name}: row ${rowIndex + 1} is cropped by the thread at ${width} wide. The ` +
                "frame's height is a minimum so that it can grow instead.",
            ).toBeGreaterThanOrEqual(-0.5);
          }
          expect(
            frame.composerBelowThread,
            `${name}: the composer overlaps the newest row at ${width} wide`,
          ).toBeGreaterThanOrEqual(-0.5);
          expect(
            frame.composerInsideFrame,
            `${name}: the composer runs out of the frame at ${width} wide`,
          ).toBeGreaterThanOrEqual(-0.5);
          // A header wider than its frame is clipped by the frame's own
          // `overflow-hidden`: the subtitle has to truncate instead.
          expect(
            frame.headerOverflow,
            `${name}: the header row overflows the frame at ${width} wide`,
          ).toBeLessThanOrEqual(0.5);
          // From `lg` up the fold frame bleeds off the right edge on purpose.
          // Otherwise a frame is whole and must sit inside its section's
          // content box: past it, the hero's `overflow-hidden` cuts the edge
          // off, or the page scrolls sideways.
          if (index === 1 || width < 1024) {
            expect(
              frame.insideShell,
              `${name} runs past its section's content edge at ${width} wide`,
            ).toBeGreaterThanOrEqual(-0.5);
          }
        }
      } finally {
        await context.close();
      }
    });
  }
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  deriveSignetPalette,
  SIGNET_FILL_SURFACES,
  signetAccentSemanticVars,
} from "@repo/chapter-theme";
import { describe, expect, it } from "vitest";

import { isCompleteColor, SIMPLE_COLOR } from "./complete-color";
import {
  LANDING_TAILWIND,
  readConfigCode,
  WEB_TAILWIND,
} from "./config-sources";

import { getSignetCssVars, signetDarkTokens } from "./signet";
import config from "./tailwind.config";

/**
 * The contract between `signet.css` and everything that reads it.
 *
 * `signet.css` is the Signet stylesheet BOTH web surfaces ship — `apps/web`
 * since the #920 shell cutover, `apps/landing` since the #2366 token cutover.
 * The legacy `globals.css` it used to be a sibling of was deleted in that same
 * cutover. It is hand-written CSS with three sources of truth it must not drift from, so
 * each is asserted rather than trusted:
 *
 *  1. The fixed foundations — `getSignetCssVars()` in `signet.ts`, itself
 *     pinned to `spec/ui/design-system/foundations.md` by `signet.spec.ts`.
 *  2. The accent-slot defaults — the house seed run through the real engine
 *     (`deriveSignetPalette`), because `accent-engine.md` §3 defines the
 *     no-accent chapter as exactly that pipeline output, and a hand-edited
 *     default would silently diverge from what a saved chapter gets.
 *  3. The Tailwind preset (shared + the `apps/web` AND `apps/landing`
 *     extensions) — every token a color key reads must be defined here as a
 *     complete color, or the class compiles to nothing (#1145's failure mode).
 *
 * It also pins the surface wiring: both apps import this file and neither
 * imports the legacy stylesheet — the "two systems must not mix on one surface"
 * rule (`spec/ui/design-system/foundations.md` §1) as a test. Before #2366 this
 * asserted the opposite for `apps/landing`; the boundary it guards is the same
 * one, now that the cutover has moved that surface across it.
 */

const SIGNET = fileURLToPath(new URL("./signet.css", import.meta.url));
const css = readFileSync(SIGNET, "utf8");

const WEB_GLOBALS = fileURLToPath(
  new URL("../../../apps/web/app/globals.css", import.meta.url),
);
const LANDING_GLOBALS = fileURLToPath(
  new URL("../../../apps/landing/app/globals.css", import.meta.url),
);
/*
 * Read as source text, not imported: `apps/web` is a separate TS project, and
 * pulling its config module into this package's typecheck would couple the two
 * builds. Every Signet-only color key in that config reads its token through
 * `colorVar("--x")`, so the literal scan sees exactly the set the walker would.
 */
/* Paths and the comment-stripping reader are shared with `tailwind.config.spec.ts`. */

/** `--token` → declared value, for the single `:root` block. */
function declaredIn(source: string): Map<string, string> {
  const block = source.match(/^\s*:root\s*\{([\s\S]*?)^\s*\}/m);
  if (!block?.[1]) throw new Error("signet.css has no :root block");
  const declarations = new Map<string, string>();
  for (const [, name, value] of block[1].matchAll(
    /^\s*(--[\w-]+):\s*([^;]+);/gm,
  )) {
    declarations.set(name!, value!.replace(/\s+/g, " ").trim());
  }
  return declarations;
}

const root = declaredIn(css);

/** Every custom property a config's color keys read through `colorVar`. */
function tokensReadBy(colors: unknown): string[] {
  const tokens: string[] = [];
  const visit = (node: unknown): void => {
    // A bare `var(--token)` string is the only shape a colour key takes. It was
    // a `({ opacityValue }) => string` function until the Tailwind v4 bump,
    // which ignores non-string colour values outright — so a function reaching
    // here again means those keys are being dropped by the compiler, and this
    // walker must not quietly resolve one back into a token it no longer emits.
    if (typeof node === "string") {
      const token = node.match(/^var\((--[\w-]+)\)$/)?.[1];
      if (token) tokens.push(token);
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const value of Object.values(node)) visit(value);
    }
  };
  visit(colors);
  return tokens;
}

describe("signet.css is dark-only and side-token-free", () => {
  it("declares no .dark block — Signet has one appearance", () => {
    expect(css).not.toMatch(/^\s*\.dark\s*\{/m);
  });

  it("defines no --side-* token — that family died with the legacy shell", () => {
    expect([...root.keys()].filter((t) => t.startsWith("--side-"))).toEqual([]);
  });

  it("neutralizes every shadow token — elevation is a lighter surface", () => {
    // `--shadow-md` is load-bearing rather than decorative: `shadow-md` is
    // bound to it in the shared preset `packages/theme/src/tailwind.config.ts`
    // (app-local until #2371) precisely so the utility cannot fall through to
    // Tailwind's stock scale and draw a real shadow. If
    // this token is ever dropped, that binding resolves to nothing and the ban
    // reopens silently — which is what this roster is here to prevent.
    for (const key of [
      "--shadow-xs",
      "--shadow-sm",
      "--shadow",
      "--shadow-md",
      "--shadow-lg",
    ]) {
      expect(root.get(key), `${key} must be defined`).toBe("none");
    }
  });
});

describe("the fixed foundations match signet.ts (and through it, foundations.md)", () => {
  const expected = getSignetCssVars();

  it.each(Object.entries(expected))("%s is %s", (token, value) => {
    expect(
      root.get(token),
      `signet.css defines ${token} as "${root.get(token)}", but ` +
        `getSignetCssVars() (pinned to foundations.md) says "${value}"`,
    ).toBe(value);
  });
});

describe("the engine's fill floor is measured against the ladder that ships", () => {
  // `@repo/chapter-theme` restates the ladder (it cannot import this package,
  // which depends on it) and lifts every chapter's fill until it clears 3:1 on
  // it (accent-engine.md §8, #2541). A ladder retune that skipped it would
  // leave fills clearing 3:1 only on surfaces that no longer ship.
  const { surface } = signetDarkTokens.color;

  it("matches signetDarkTokens", () => {
    expect(SIGNET_FILL_SURFACES).toEqual({
      "--background": surface.background,
      "--surface-1": surface.surface1,
      "--card": surface.card,
      "--popover": surface.popover,
    });
  });

  it.each(Object.entries(SIGNET_FILL_SURFACES))(
    "matches signet.css's %s",
    (token, value) => {
      expect(root.get(token)?.toUpperCase()).toBe(value);
    },
  );
});

describe("the accent-slot defaults are the house seed through the real engine", () => {
  // accent-engine.md §3: a chapter with no accent runs the house seed through
  // the same pipeline — so the stylesheet's static defaults must be exactly
  // that pipeline's output, not hand-tuned approximations of it.
  const house = deriveSignetPalette();

  it("resolves the house seed cleanly", () => {
    expect(house.invalidSeed).toBe(false);
    expect(house.contrastChecks.every((c) => c.passes)).toBe(true);
  });

  it.each(Object.entries(signetAccentSemanticVars(house.palette)))(
    "%s is the engine's %s",
    (token, value) => {
      expect(root.get(token)).toBe(value);
    },
  );
});

describe("every token the presets read is defined as a complete color", () => {
  const shared = tokensReadBy(config.theme?.extend?.colors);
  const appExtension = (source: string): string[] =>
    [...readConfigCode(source).matchAll(/colorVar\("(--[\w-]+)"\)/g)].map(
      (m) => m[1]!,
    );
  const webExtension = appExtension(WEB_TAILWIND);
  // Both app configs are still scanned even though #2371 left them holding
  // almost nothing — `apps/web` its five `gold-*` keys, `apps/landing` none at
  // all. The scan is what would catch a key reappearing app-locally, which is
  // the regression that issue was about, so it outlives the duplication.
  const landingExtension = appExtension(LANDING_TAILWIND);
  const referenced = [
    ...new Set([...shared, ...webExtension, ...landingExtension]),
  ];

  it("scans a real corpus, so an empty result means something", () => {
    /*
     * Re-derived for the homes #2371 left behind, not lowered to whatever
     * passes. The preset absorbed the common subset, so its floor goes UP (39
     * today); `apps/web` keeps only the five `gold-*` keys, and `apps/landing`
     * keeps NO colour keys at all — its entire colour surface is shared now.
     *
     * The two app numbers are exact rather than floors on purpose: they are
     * small, closed sets now, and a key reappearing in an app config is the
     * regression this whole issue was about. The preset's is still a floor,
     * because tokens legitimately get added there.
     *
     * `referenced` is what the parametrized assertion below consumes, so it is
     * the one that actually has to be non-trivial.
     */
    expect(shared.length).toBeGreaterThan(30);
    expect(webExtension).toHaveLength(5);
    expect(landingExtension).toHaveLength(0);
    expect(referenced.length).toBeGreaterThan(30);
  });

  it.each(referenced)(
    "%s is defined in signet.css as a complete color",
    (token) => {
      const value = root.get(token);
      expect(
        value,
        `a Tailwind color key reads ${token} but signet.css never defines it — ` +
          "on the Signet surface the class compiles to nothing (#1145)",
      ).toBeDefined();
      expect(isCompleteColor(value!), `${token} is "${value}"`).toBe(true);
    },
  );

  it("defines every radius token the preset reads", () => {
    // The 20 step used to live in the `apps/web` config, because the legacy
    // stylesheet — since deleted (#2366) — had no `--radius-2xl`, and scanning
    // only the shared preset would have left exactly the newest key unguarded.
    // #2371 moved it up, so the preset's own scale now covers it and the
    // app-local scan is INVERTED rather than deleted: it pins that no radius
    // key has drifted back into an app config.
    const shared = Object.values(
      config.theme!.extend!.borderRadius as Record<string, string>,
    ).map((value) => String(value).match(/var\((--[\w-]+)\)/)?.[1]);
    // BOTH configs, not just `apps/web`: `apps/landing` also lost a
    // `borderRadius` block to #2371, so it is equally a re-drift site.
    const appOnly = [WEB_TAILWIND, LANDING_TAILWIND].flatMap((source) =>
      [...readConfigCode(source).matchAll(/var\((--radius-[\w-]+)\)/g)].map(
        (m) => m[1]!,
      ),
    );

    expect(shared).toContain("--radius-2xl");
    expect(appOnly).toEqual([]);
    for (const token of shared) {
      expect(token).toBeDefined();
      expect(root.has(token!), `signet.css must define ${token}`).toBe(true);
    }
  });

  it("matches the radius map in signet.ts (and through it, foundations §8)", () => {
    // The 20 ceiling is shared by sheets, dialogs and the AI answer card, so a
    // drift here is a drift on three surfaces at once.
    const { radius } = signetDarkTokens;
    expect(root.get("--radius-md")).toBe(`${radius.control}px`);
    expect(root.get("--radius-lg")).toBe(`${radius.card}px`);
    expect(root.get("--radius-xl")).toBe(`${radius.cardLarge}px`);
    expect(root.get("--radius-2xl")).toBe(`${radius.sheet}px`);
    expect(root.get("--radius-xs")).toBe(`${radius.chip}px`);
    expect(root.get("--radius-sm")).toBe(`${radius.chipLarge}px`);
  });
});

describe("the complete-colour guard rejects invalid color-mix values", () => {
  // The guard is only worth having if it fails on the shapes a typo actually
  // produces. A regex loose enough to cross nested parens accepted all three of
  // these, which would have let a token that paints nothing reach the browser.
  it.each([
    "color-mix(in srgb, red)",
    "color-mix(in srgb, var(--a) 22%, var(--b)",
    "color-mix(in srgb, var(--a), var(--b), var(--c))",
    "not-a-color",
  ])("rejects %s", (value) => {
    expect(isCompleteColor(value)).toBe(false);
  });

  it.each([
    "#0E0D0B",
    "rgba(255,255,255,0.08)",
    "color-mix(in srgb, rgb(0 0 0) 8%, var(--primary-hover))",
    "color-mix(in srgb, var(--accent-border) 22%, var(--accent-subtle))",
  ])("accepts %s", (value) => {
    expect(isCompleteColor(value)).toBe(true);
  });
});

describe("the derived accent steps track the slot rather than restating it", () => {
  // components.md §3 names two states the engine emits no role for. They are
  // mixes of the live slot on purpose: the failure this guards against is
  // someone "simplifying" them to fixed hexes, which would silently pin every
  // chapter's hover and pressed states to the house gold.
  it.each(["--primary-pressed", "--accent-subtle-hover"])(
    "%s is a color-mix of tokens, not a fixed value",
    (token) => {
      const value = root.get(token);
      expect(value).toMatch(/^color-mix\(/);
      expect(value).toMatch(/var\(--/);
    },
  );
});

describe("the status tints are the §5 recipe over a fixed semantic (#2376)", () => {
  // A mix of the semantic hue, never a literal and never the accent slot: a
  // literal cannot be separable from every ladder step at once, and the slot
  // would retint a status per chapter. And the mix, not an alpha utility,
  // because a custom property that fails to parse leaves no fill rather than
  // the solid hue (the colour of the label's own text).
  it.each([
    ["--success-tint", "--success", "13%"],
    ["--warning-tint", "--warning", "13%"],
    ["--destructive-tint", "--destructive", "13%"],
    ["--destructive-tint-hover", "--destructive", "20%"],
  ])("%s mixes %s at %s with transparent", (token, hue, amount) => {
    expect(root.get(token)).toBe(
      `color-mix(in oklab, var(${hue}) ${amount}, transparent)`,
    );
  });
});

describe("each surface imports exactly its own system", () => {
  // Both web surfaces are Signet since #2366 took the landing across. This used
  // to be the FREEZE boundary — web Signet, landing legacy — and is now the
  // no-mixing rule with nothing left on the other side: an import swap on
  // either side silently reskins a surface it must not touch, and pulling the
  // legacy stylesheet back onto either one would put two token systems on one
  // surface.
  const web = readFileSync(WEB_GLOBALS, "utf8");
  const landing = readFileSync(LANDING_GLOBALS, "utf8");

  // Both spellings of the same file are accepted: the legacy relative reach
  // into `packages/theme/src/`, and the `@repo/theme/*` subpath the apps use
  // now that the package declares those exports. What the freeze turns on is
  // *which* stylesheet a surface pulls in, never how the specifier is written —
  // so the negative assertions below, not these, are the boundary.
  const imports = (stylesheet: string) =>
    new RegExp(
      `@import\\s+"(?:[^"]*packages/theme/src/|@repo/theme/)${stylesheet}\\.css"`,
    );

  it("apps/web imports signet.css and not the legacy stylesheet", () => {
    expect(web).toMatch(imports("signet"));
    expect(web).not.toMatch(/globals\.css"/);
  });

  it("apps/landing imports signet.css and not the legacy stylesheet", () => {
    expect(landing).toMatch(imports("signet"));
    expect(landing).not.toMatch(/globals\.css"/);
  });
});

/*
 * ============================================================================
 * The no-retint boundary, as a test rather than as four docstrings.
 * ============================================================================
 *
 * `spec/ui/brand-identity.md` §2: the mark and logo MUST NOT take the chapter
 * accent, ever. `spec/ui/web-greenfield/README.md` §2 restates it precisely
 * because it is "the lock a greenfield lane is most likely to break by
 * accident, wiring the mark to `--primary` with everything else."
 *
 * What was already covered, stated accurately because the first draft of this
 * block did not: the blocks above compare every declared value against
 * `signet.ts`, so editing `signet.css` alone to read `var(--primary)` already
 * failed. That is a **consistency** check between two files, and it holds only
 * while one of them stays right.
 *
 * What it does not cover, and what these three tests add:
 *
 * 1. **Both files moving together.** Setting `scrollbar.thumb` to
 *    `"var(--primary)"` in `signet.ts` and letting `signet.css` follow leaves
 *    the two in perfect agreement and every existing assertion green. The rule
 *    is that these values are self-contained colours, so it is asserted as a
 *    rule rather than inferred from a match.
 * 2. **The bridge's key set.** `signetAccentSemanticVars` is the only thing
 *    that turns a chapter seed into semantic token names. Adding a fixed-family
 *    key to it retints that token on every chapter at once, and is caught today
 *    only indirectly — by a value assertion that happens to notice, and would
 *    not if the mapped value coincided with the house default, which for the
 *    house tenant it does. `tokens.md` L-01 names this exact trap ("A lane that
 *    merges them on the board's authority breaks the no-retint rule on every
 *    chapter that picks an accent") and nothing stated it as a rule.
 * 3. **`::selection`**, which had no value, no token and no test before lane 7.
 */
describe("the fixed families cannot be wired to the accent slot", () => {
  /** Every token the brand lock keeps out of the accent engine. */
  const FIXED = [
    // The mention family states "you were addressed" and must read identically
    // in every chapter (foundations §5), so it is locked out of the engine for
    // the same reason the gold family is — including the in-body chip, whose
    // whole guarantee is that its text/fill ratio does not move per tenant.
    "--mention",
    "--mention-foreground",
    "--mention-chip",
    "--mention-chip-text",
    "--gold-house",
    "--gold-on-house",
    "--gold-ask-fill",
    "--gold-ask-border",
    "--gold-ask-text",
    "--scrollbar-thumb",
    "--scrollbar-thumb-hover",
    "--scrollbar-track",
  ] as const;

  it.each(FIXED)("%s is a literal, not a read of anything", (token) => {
    const value = root.get(token);
    expect(value, `${token} is not declared in signet.css`).toBeDefined();
    // Deliberately stricter than "does not mention --primary". A `color-mix()`
    // of the slot, a `var(--accent-text)`, or an indirection through a token
    // that is itself derived would all retint; only a self-contained colour
    // cannot. This is the same shape as the `--primary-pressed` guard above,
    // inverted.
    expect(value).not.toMatch(/var\(/);
    expect(value).toMatch(SIMPLE_COLOR);
  });

  it("the accent bridge emits no key that lands on one of them", () => {
    // The structural half. `signetAccentSemanticVars` is the only thing that
    // turns a chapter seed into semantic token names, and
    // `use-chapter-theme.ts` writes exactly its output onto `:root`. So the
    // whole no-retint guarantee for every token in this file reduces to: that
    // function's key set never intersects the fixed set. Adding
    // `"--gold-ask-fill": palette[...]` to the bridge is the one edit that
    // breaks the lock everywhere at once, and it now fails here.
    const applied = Object.keys(
      signetAccentSemanticVars(deriveSignetPalette("#9B4DD6").palette),
    );
    expect(
      applied.filter((key) => (FIXED as readonly string[]).includes(key)),
    ).toEqual([]);
  });

  it("the scrollbar is the locked brand pair, not a near-miss of it", () => {
    // `#2153` is the precedent: three nearly-but-not-quite golds on one screen
    // survived for months because every copy was a separate literal and no
    // test compared them. These read from `signet.ts`, which is the token
    // source, so a re-pitch there moves the assertion with it.
    expect(root.get("--scrollbar-thumb")).toBe(
      signetDarkTokens.color.gold.seed,
    );
    expect(root.get("--scrollbar-track")).toBe(
      signetDarkTokens.color.surface.surface1,
    );
  });
});

describe("text selection is neutral, and deliberately so", () => {
  // The one piece of chrome that had no Signet value at all before lane 7: an
  // unstyled `::selection` falls through to the user agent's system blue.
  const rule = css.match(/::selection\s*\{([^}]*)\}/);

  it("exists", () => {
    expect(rule?.[1]).toBeDefined();
  });

  it("takes the two ends of the neutral ladder", () => {
    expect(rule![1]).toMatch(/background-color:\s*var\(--foreground\)/);
    expect(rule![1]).toMatch(/color:\s*var\(--background\)/);
  });

  it("does not read the accent slot, which would vanish on the self bubble", () => {
    // The regression this guards is the first version of the rule.
    // `text-renderer.tsx` paints the viewer's own chat bubble
    // `bg-primary text-primary-foreground`; a selection wired to that same pair
    // changes nothing when you drag across your own message. Stepping to
    // `--accent-text` does not help either \u2014 accent-11 on accent-9 measures
    // ~1.18:1 on the house seed, under the fixture's perceptibility floor.
    for (const token of [
      "--primary",
      "--primary-hover",
      "--primary-foreground",
      "--accent-subtle",
      "--accent-border",
      "--accent-text",
      "--ring",
    ]) {
      expect(rule![1]).not.toContain(token);
    }
  });

  it("cannot collide, because neither end is reachable by the engine", () => {
    // The structural half: `--foreground` and `--background` are outside the
    // bridge's output, so no chapter seed can move either one onto the other.
    const applied = Object.keys(
      signetAccentSemanticVars(deriveSignetPalette("#9B4DD6").palette),
    );
    expect(applied).not.toContain("--foreground");
    expect(applied).not.toContain("--background");
  });
});

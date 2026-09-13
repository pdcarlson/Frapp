import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  deriveSignetPalette,
  signetAccentSemanticVars,
} from "@repo/chapter-theme";
import { describe, expect, it } from "vitest";

import { getSignetCssVars, signetDarkTokens } from "./signet";
import config from "./tailwind.config";

/**
 * The contract between `signet.css` and everything that reads it.
 *
 * `signet.css` is the Signet stylesheet `apps/web` ships since the #920 shell
 * cutover, sibling to the legacy `globals.css` that keeps serving the frozen
 * `apps/landing`. It is hand-written CSS with three sources of truth it must
 * not drift from, so each is asserted rather than trusted:
 *
 *  1. The fixed foundations — `getSignetCssVars()` in `signet.ts`, itself
 *     pinned to `spec/ui/design-system/foundations.md` by `signet.spec.ts`.
 *  2. The accent-slot defaults — the house seed run through the real engine
 *     (`deriveSignetPalette`), because `accent-engine.md` §3 defines the
 *     no-accent chapter as exactly that pipeline output, and a hand-edited
 *     default would silently diverge from what a saved chapter gets.
 *  3. The Tailwind preset (shared + the `apps/web` extension) — every token a
 *     color key reads must be defined here as a complete color, or the class
 *     compiles to nothing (#1145's failure mode, on the new stylesheet).
 *
 * It also pins the surface wiring: `apps/web` imports this file, the frozen
 * `apps/landing` imports the legacy one — the "two systems must not mix on one
 * surface" rule (`spec/ui/design-system/foundations.md` §1) as a test.
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
const WEB_TAILWIND = fileURLToPath(
  new URL("../../../apps/web/tailwind.config.ts", import.meta.url),
);

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

/*
 * A value the preset can hand Tailwind as a bare `var(--token)` and have the
 * browser paint. `color-mix()` is in the set because the derived accent steps
 * (`--primary-pressed`, `--accent-subtle-hover`) are mixes of the accent slot
 * rather than fixed values — that is what keeps them tracking a chapter's
 * override instead of needing a second thing to re-derive.
 *
 * A regex alone is the wrong shape for `color-mix()`: its arguments nest
 * parens, and a pattern loose enough to cross them (`.+\)`) also accepts a
 * dropped closing paren or a single colour argument — both invalid CSS that
 * would paint nothing, which is precisely what this guard exists to catch.
 * Parens are therefore balanced by counting and the argument count checked.
 */
const SIMPLE_COLOR = /^(#[0-9a-f]{3,8}|(hsla?|rgba?)\([^)]*\))$/i;

function isBalanced(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function isCompleteColor(value: string): boolean {
  if (SIMPLE_COLOR.test(value)) return true;
  const mix = /^color-mix\(in ([\w-]+(?: [\w-]+)?),(.+)\)$/i.exec(value);
  if (!mix || !isBalanced(value)) return false;
  // Split the argument list on top-level commas only — `var(--a, fallback)`
  // and a nested mix both carry commas that are not argument separators.
  let depth = 0;
  const parts: string[] = [];
  let current = "";
  for (const char of mix[2]!) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  // `color-mix()` takes exactly two colours, each optionally with a percentage.
  return parts.length === 2 && parts.every((part) => part.trim().length > 0);
}

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
    // bound to it in `apps/web/tailwind.config.ts` precisely so the utility
    // cannot fall through to Tailwind's stock scale and draw a real shadow. If
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
  const webExtension = [
    ...readFileSync(WEB_TAILWIND, "utf8").matchAll(/colorVar\("(--[\w-]+)"\)/g),
  ].map((m) => m[1]!);
  const referenced = [...new Set([...shared, ...webExtension])];

  it("scans a real corpus, so an empty result means something", () => {
    expect(shared.length).toBeGreaterThan(15);
    expect(webExtension.length).toBeGreaterThan(10);
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
    // Both halves: the shared preset's scale keys, and the Signet-only ones
    // the `apps/web` config adds on top. The 20 step lives in the app config
    // because the legacy stylesheet has no `--radius-2xl`, so scanning only
    // the shared preset would leave exactly the newest key unguarded.
    const shared = Object.values(
      config.theme!.extend!.borderRadius as Record<string, string>,
    ).map((value) => String(value).match(/var\((--[\w-]+)\)/)?.[1]);
    const webOnly = [
      ...readFileSync(WEB_TAILWIND, "utf8").matchAll(
        /var\((--radius-[\w-]+)\)/g,
      ),
    ].map((m) => m[1]!);

    expect(webOnly.length).toBeGreaterThan(0);
    for (const token of [...shared, ...webOnly]) {
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

describe("each surface imports exactly its own system", () => {
  // The freeze boundary as a test: `apps/web` is Signet, `apps/landing` stays
  // legacy until its own reskin. An import swap on either side silently
  // reskins a surface it must not touch.
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

  it("apps/landing imports the legacy stylesheet and not signet.css", () => {
    expect(landing).toMatch(imports("globals"));
    expect(landing).not.toMatch(/signet\.css/);
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

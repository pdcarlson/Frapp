import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveSignetPalette,
  signetAccentSemanticVars,
} from "@repo/chapter-theme";
import { describe, expect, it } from "vitest";

import { isCompleteColor, SIMPLE_COLOR } from "./complete-color";
import {
  LANDING_TAILWIND,
  readConfigCode,
  WEB_TAILWIND,
} from "./config-sources";
import config from "./tailwind.config";

/**
 * The contract between `signet.css` and the shared Tailwind preset.
 *
 * **Re-pointed from the legacy `globals.css` when that stylesheet was deleted**
 * (#2366): `apps/landing` was its last importer, and a contract test aimed at a
 * retired file asserts nothing about what ships. `signet.css.spec.ts` covers the
 * same preset-key-is-defined ground for the Signet-only app configs; what lives
 * only here is the repo-wide `hsl(var(--x))` ban (#1151) and the postcss
 * compile probes at the bottom, which are the only checks in this package that
 * drive the real Tailwind pipeline.
 *
 * Two separate defects motivated this file, and both were silent — no console
 * warning, no build error, just an element rendering without the color it
 * asked for:
 *
 *  - #1145: `bg-secondary` / `text-secondary-foreground` shipped in four
 *    ShadCN primitives while neither custom property was defined anywhere.
 *    The classes compiled to nothing.
 *  - #1143: per-chapter accents are persisted as **hex** by the accent engine,
 *    but the preset wrapped the same token names in `hsl(...)`, so an injected
 *    `#C49A3A` became the invalid `hsl(#C49A3A)`.
 *
 * Both reduce to one invariant: *every color token the preset reads must be
 * defined, and defined in the format the preset reads it in.* That is what is
 * asserted here, structurally, so neither defect can return and a future token
 * cannot be added in the wrong format.
 */

const STYLESHEET = fileURLToPath(new URL("./signet.css", import.meta.url));
const css = readFileSync(STYLESHEET, "utf8");

// ── signet.css ───────────────────────────────────────────────────────────────

/** `--token` → declared value, for one selector block of `signet.css`. */
function declaredIn(selector: string): Map<string, string> {
  const block = css.match(
    new RegExp(`^\\s*${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)^\\s*\\}`, "m"),
  );
  if (!block?.[1]) throw new Error(`signet.css has no ${selector} block`);

  const declarations = new Map<string, string>();
  for (const [, name, value] of block[1].matchAll(
    /^\s*(--[\w-]+):\s*([^;]+);/gm,
  )) {
    declarations.set(name!, value!.trim());
  }
  return declarations;
}

const root = declaredIn(":root");

/*
 * There is no `.dark` map any more, and its absence is the point rather than an
 * omission. The legacy stylesheet had a light `:root` and a `.dark` override, so
 * this suite had to check that no token was dark-only (undefined in light mode
 * is the same silent failure by another route). Signet defines a SINGLE
 * appearance — one `:root`, no light palette — so a dark-only token cannot
 * exist. `signet.css.spec.ts` asserts the absence of the block itself, so
 * nothing is lost by dropping the machinery here.
 */

// ── the preset ───────────────────────────────────────────────────────────────

type Reference = { key: string; token: string; style: "triple" | "complete" };

/**
 * Every custom property the preset's color keys read, and how.
 *
 * A bare `var(--token)` string — what `colorVar` emits — needs a complete color
 * on the other side, because Tailwind hands the property straight to the browser
 * and applies any opacity modifier itself. A string wrapping the property in
 * `hsl(...)` needs a bare HSL triple instead; no key is written that way any
 * more, but the shape is still classified so that reintroducing one is checked
 * rather than waved through. A literal color would reference no property and be
 * skipped; the `navy` and `emerald` legacy brand scales were the last such keys
 * and went with the landing cutover (#2366), so the preset has none today.
 *
 * A **function** value is now a defect rather than a third shape. v3 called it
 * with `{ opacityValue }` and `colorVar` used to be one; v4 dropped that
 * mechanism and silently drops any colour value that is not a string, so a
 * function here means every utility built on that key compiles to nothing —
 * #1145 once more, and invisible short of compiling the sheet and grepping it.
 * It is collected as unrecognised so this suite fails instead of the UI.
 */
function scanColors(): { references: Reference[]; unrecognised: string[] } {
  const references: Reference[] = [];
  const unrecognised: string[] = [];

  const visit = (node: unknown, key: string): void => {
    if (typeof node === "function") {
      unrecognised.push(
        `${key} is a function; Tailwind v4 drops non-string colour values, so ` +
          "every utility built on it would compile to nothing",
      );
      return;
    }
    if (typeof node === "string") {
      const bare = node.match(/^var\((--[\w-]+)\)$/);
      if (bare) {
        references.push({ key, token: bare[1]!, style: "complete" });
        return;
      }
      const wrapped = node.match(/^hsl\(var\((--[\w-]+)\)\)$/);
      if (wrapped) references.push({ key, token: wrapped[1]!, style: "triple" });
      else if (node.includes("var(")) {
        unrecognised.push(`${key} reads a custom property in an unrecognised form: "${node}"`);
      }
      return;
    }
    if (typeof node !== "object" || node === null) {
      unrecognised.push(`${key} is neither a colour, a group, nor a function: ${String(node)}`);
      return;
    }
    for (const [child, value] of Object.entries(node)) {
      visit(value, `${key}.${child}`);
    }
  };

  visit(config.theme?.extend?.colors, "colors");
  return { references, unrecognised };
}

/**
 * Scanned once, at module scope, because `it.each` needs the list at collection
 * time — and therefore scanned WITHOUT asserting. An `expect()` that throws out
 * here does not fail a test, it aborts the module: vitest reports the file as
 * `(0 test)` and every assertion below, including the `references.length` guard
 * that exists to catch exactly this, silently never registers. Anomalies are
 * collected and asserted inside a real test instead.
 */
const { references, unrecognised } = scanColors();

const HSL_TRIPLE = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;
/*
 * #2371 moved `--primary-pressed` and `--accent-subtle-hover` into the shared
 * preset, which put a `color-mix()` value inside this file's scanned surface
 * for the first time — they were app-local before, and this suite scans the
 * preset. `isCompleteColor` (shared with `signet.css.spec.ts`, see
 * `./complete-color`) is what understands that form: a regex cannot, because
 * `color-mix()` nests parens and any pattern loose enough to cross them also
 * accepts a single colour argument or a dropped paren — invalid CSS that
 * paints nothing, which is the #1145 failure this guard exists to catch.
 *
 * **`color-mix()` is allowed for exactly two tokens, by name.** `colorVar`'s
 * docstring records why: a `color-mix()` token degrades to NO FILL below the
 * `color-mix` support floor, and those two are hover/pressed states on
 * controls that stay legible without them — "Do not reach for a `color-mix`
 * token for a *rest* state." A third one is a decision, not a typo, so it
 * fails here rather than passing quietly.
 */
const MIX_ALLOWED = new Set(["--primary-pressed", "--accent-subtle-hover"]);

// ── Assertions ───────────────────────────────────────────────────────────────

describe("every token the preset reads is defined", () => {
  it("has at least the colors we expect to find", () => {
    // Guards the walker itself: a parse that quietly found nothing would make
    // every assertion below vacuous.
    expect(references.length).toBeGreaterThan(20);
  });

  it("understands every colour value in the preset", () => {
    // A value the walker cannot classify is not benign — it is a token this
    // suite has stopped checking. Most likely arrival: someone writes a colour
    // in Tailwind's canonical `hsl(var(--x) / <alpha-value>)` form, which is
    // neither of the two shapes the preset uses.
    expect(unrecognised).toEqual([]);
  });

  it.each(references)("$key reads $token, which :root defines", ({ token }) => {
    expect(
      root.has(token),
      `the preset reads ${token} but signet.css :root never defines it — ` +
        "the class will compile to nothing (#1145)",
    ).toBe(true);
  });

  it("defines every non-colour token the preset reads", () => {
    // `fontSize`, `minHeight` and `minWidth` joined this check with #2371,
    // which moved them into the preset. Before that they were app-local and
    // NOTHING walked preset -> stylesheet for them, so a key reading an
    // undefined property would have compiled to `font-size: var(--nope)` —
    // #1145's silent failure — with both suites green.
    //
    // Every `var()` in the value is checked, not just the first: a `fontSize`
    // entry is `[size, { lineHeight, fontWeight }]`, and the weight is a token
    // too. The literal line heights are not tokens and are skipped by the same
    // pass (tracked as L-09).
    const { borderRadius, boxShadow, fontSize, minHeight, minWidth } =
      config.theme!.extend!;
    for (const [group, values] of Object.entries({
      borderRadius,
      boxShadow,
      fontSize,
      minHeight,
      minWidth,
    })) {
      for (const [key, value] of Object.entries(
        values as Record<string, unknown>,
      )) {
        const tokens = [
          ...JSON.stringify(value).matchAll(/var\((--[\w-]+)\)/g),
        ].map((m) => m[1]!);
        expect(
          tokens.length,
          `${group}.${key} should read at least one custom property`,
        ).toBeGreaterThan(0);
        for (const token of tokens) {
          expect(root.has(token), `${group}.${key} reads undefined ${token}`).toBe(
            true,
          );
        }
      }
    }
    // `fontFamily` is deliberately not checked: `--font-figtree` is injected
    // by the consuming app's Next font loader, not by this stylesheet.
  });
});

describe("token format matches how the preset reads it", () => {
  it.each(references)("$token is stored as a $style value", ({ token, style }) => {
    const value = root.get(token);
    if (value === undefined) return; // covered by the "is defined" assertion above
    const ok =
      style === "triple"
        ? HSL_TRIPLE.test(value)
        : MIX_ALLOWED.has(token)
          ? isCompleteColor(value)
          : SIMPLE_COLOR.test(value);
    expect(
      ok,
      `:root defines ${token} as "${value}", but the preset reads it as a ` +
        `${style} value. A mismatch here renders nothing at all (#1143).` +
        (MIX_ALLOWED.has(token)
          ? ""
          : " Only the two button-state tokens in MIX_ALLOWED may be a" +
            " `color-mix()`; a rest-state token must be a finished colour."),
    ).toBe(true);
  });
});

describe("the tokens chapter branding rewrites accept the accent engine's hex", () => {
  /**
   * Asked of the engine rather than copied from it.
   *
   * A hand-written list is the wrong shape for this guard: the failure it
   * exists to prevent is a token being ADDED on one side and not the other, and
   * a literal cannot notice that. The engine persists hex into
   * `chapters.theme_palette`, and `use-chapter-theme.ts` re-keys it onto the
   * semantic names below and writes those onto `:root` — so the moment one of
   * them is also read by the preset, it must be read in a form that accepts
   * hex. Deriving both halves means a new engine role, or a new preset key for
   * an existing one, is covered on arrival.
   *
   * Re-pointed from the legacy `derivePalette` at the #920 slice-9 cutover. The
   * comment here used to say to delete this describe along with that engine, on
   * the assumption the overlap would empty out. It did not empty — it moved:
   * `deriveSignetPalette` persists hex exactly as its predecessor did, and
   * `signetAccentSemanticVars` lands it on `--primary` and `--ring`, which the
   * preset reads. #1143's defect is reachable through the new path, so the
   * guard survives its subject.
   *
   * The devDependency is test-only and acyclic: `@repo/chapter-theme` does not
   * import `@repo/theme`.
   */
  const chapterTokens = Object.keys(
    signetAccentSemanticVars(deriveSignetPalette("#C9A56F").palette),
  );
  const readByPreset = chapterTokens.filter((token) =>
    references.some((r) => r.token === token),
  );

  it("still finds the overlap it is meant to police", () => {
    // If the intersection empties out — the engine renames its tokens, the
    // preset drops the keys — every assertion below passes by describing
    // nothing. That is the one way this guard can fail silently.
    //
    // The overlap shrank to `--ring` when the #920 shell cutover deleted the
    // preset's `side-*` keys (zero class consumers remained), then widened
    // again at slice 9 when this was re-pointed at the Signet engine, whose
    // semantic re-key covers `--primary` and `--primary-foreground` too.
    expect(chapterTokens.length).toBeGreaterThan(0);
    expect(readByPreset).toEqual(
      expect.arrayContaining(["--ring", "--primary"]),
    );
  });

  it.each(readByPreset)("%s is read in a hex-compatible form", (token) => {
    for (const { key, style } of references.filter((r) => r.token === token)) {
      expect(
        style,
        `${key} reads ${token} as an HSL triple, but the accent engine persists ` +
          `${token} as hex — it would resolve to hsl(#RRGGBB) and be dropped by ` +
          "the browser (#1143). Either store it as a complete colour and read it " +
          "through colorVar(), or stop writing it from the accent engine.",
      ).toBe("complete");
    }
  });

  it("still renders a chapter's hex through the preset", () => {
    // The value has to be the property itself and nothing else: the engine
    // writes hex onto `--ring` at runtime, so anything wrapping or reformatting
    // it here is #1143 again.
    const colors = config.theme!.extend!.colors as Record<string, unknown>;
    expect(colors["ring"]).toBe("var(--ring)");
  });
});

describe("nothing hand-writes hsl(var(--x)) around a complete-colour token", () => {
  /**
   * The preset is not the only reader (#1151).
   *
   * The legacy `globals.css` used to wrap tokens itself in its own base and
   * components layers (`* { border-color: hsl(var(--border)) }`), and so did app
   * code — three class names in `apps/web`'s dashboard shell and two SVG `fill`s
   * in `apps/landing`'s lockup. Every one of them hard-coded the bare-triple
   * assumption the preset used to share.
   *
   * Now that every colour token is stored as a **complete colour**, that
   * wrapper is always wrong: it emits `hsl(hsl(30 10% 12%))`, which the browser
   * drops, and the element silently keeps its default. There is no longer a
   * "correct" hand-written wrapper to allow, so this guard bans the shape
   * outright rather than checking it agrees with a per-token format.
   *
   * It scans the apps as well as this stylesheet, because #1151's point is that
   * a token converted here breaks call sites the preset knows nothing about,
   * and only a repo-wide scan can see them.
   *
   * **Scoped to the stylesheet, not to the preset.** The set below is every
   * complete-colour token `signet.css` declares — *not* only the ones the
   * preset reads. Several of this file's tokens are consumed exclusively by
   * hand, never through a Tailwind colour key: the scrollbar pair and
   * `--skeleton-highlight` are painted by `signet.css`'s own components layer.
   * Keying on `references` would leave exactly those unguarded — the token's
   * storage format is what makes the wrapper wrong, so storage is what the
   * guard keys on.
   *
   * The witness used to be `--brand-lockup-bg`, a legacy-stylesheet token whose
   * one consumer was an SVG `fill` in `apps/landing`'s lockup. It went with
   * `globals.css` in #2366 — that lockup now inlines the crest with the locked
   * brand hex, which is a literal by rule and not a token at all. Retargeted
   * deliberately, as the note it replaces asked: `--scrollbar-thumb` is the
   * equivalent witness on this stylesheet.
   *
   * The `--hue-*` family used to be named here as a second example. #1155
   * deleted those five: they were hand-consumable in principle and consumed by
   * nothing in fact, which is a token to remove rather than a token to guard.
   */
  const REPO = fileURLToPath(new URL("../../..", import.meta.url));
  const WRAPPER = /hsl\(\s*var\(\s*(--[\w-]+)/g;
  const SCANNED = /\.(tsx?|css)$/;
  const SKIP = new Set(["node_modules", ".next", ".expo", "dist", "build", ".turbo"]);

  /**
   * Walks by hand rather than with `readdirSync(dir, { recursive: true })`:
   * that option needs Node >= 20.1, and `package.json` declared `>=20` when
   * this was written. On an older runtime the option is ignored rather than
   * rejected, so the scan would quietly flatten to one directory level — a
   * silent under-scan, not an error. `engines` now requires at least Node 24, so the floor is
   * clear of it; the hand-rolled walk stays because a failure mode that
   * degrades quietly is not worth re-introducing for one line.
   */
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) out.push(...walk(join(dir, entry.name)));
      } else if (entry.isFile() && SCANNED.test(entry.name)) {
        out.push(join(dir, entry.name));
      }
    }
    return out;
  }

  const appSources = ["web", "landing", "mobile"].flatMap((app) => {
    const dir = join(REPO, "apps", app);
    return existsSync(dir) ? walk(dir) : [];
  });

  const sources = [
    { file: STYLESHEET, text: css },
    ...appSources.map((file) => ({ file, text: readFileSync(file, "utf8") })),
  ];

  /** Every token this stylesheet stores as a complete colour, in either block. */
  const completeTokens = new Set(
    [...root]
      .filter(([, value]) => isCompleteColor(value))
      .map(([token]) => token),
  );

  const offenders = sources.flatMap(({ file, text }) =>
    [...text.matchAll(WRAPPER)]
      .map((m) => m[1]!)
      .filter((token) => completeTokens.has(token))
      .map((token) => `${relative(REPO, file)} wraps ${token}`),
  );

  it("scans a real corpus, so an empty result means something", () => {
    // A walker that silently found no files would make the assertion below
    // vacuously true — the exact failure mode the `references.length` guard
    // above exists to catch, one directory further out.
    expect(appSources.length).toBeGreaterThan(100);
    expect(completeTokens.size).toBeGreaterThan(20);
  });

  it("covers the tokens no preset key reads", () => {
    // The regression this guard was widened to catch. `--scrollbar-thumb` is
    // the witness: hand-consumed only (painted by `signet.css`'s own components
    // layer, never through a Tailwind colour key), so a set keyed on
    // `references` would not contain it.
    //
    // A named assertion rather than a token-agnostic one, for the reason the
    // `--brand-lockup-bg` version carried: a count or a size comparison looks
    // more general and is not — it would go red on a correct change, such as
    // wiring this token into a preset colour key, with a message about set
    // sizes that says nothing about what actually broke. If this token stops
    // being hand-consumed, retarget this deliberately rather than quietly
    // narrowing back to `references`.
    expect(completeTokens.has("--scrollbar-thumb")).toBe(true);
  });

  it("still recognises the shape it is banning", () => {
    // Pins the regex itself. If it stops matching, the suite would report a
    // clean repo forever.
    const probe = [...'color: hsl(var(--border));'.matchAll(WRAPPER)].map((m) => m[1]);
    expect(probe).toEqual(["--border"]);
  });

  it("finds no hand-written wrapper around any complete-colour token", () => {
    expect(
      offenders,
      "every colour token in signet.css is stored as a complete colour, so " +
        "hsl(var(--x)) around one emits hsl(hsl(...)) and renders nothing (#1151). " +
        "Use var(--x) directly — in Tailwind, the arbitrary value needs the type " +
        "hint: text-[color:var(--x)].",
    ).toEqual([]);
  });
});

describe("opacity modifiers survive the format-agnostic reader", () => {
  /**
   * Compiled, not asserted about.
   *
   * Dozens of live classes depend on this — `bg-primary/15`,
   * `border-destructive/45` and friends. (Not the §5 status tints: those
   * moved to opaque `bg-*-tint` tokens in #2376, pinned at the end of this
   * block, because a modifier's fallback is the solid hue.) Under v3 the preset
   * hand-rolled the alpha branch inside `colorVar`, and this block probed that
   * function directly. That was only ever a proxy for the real question, and on
   * the v4 bump the proxy went green while every one of those classes compiled
   * to **nothing**: v4 ignores non-string colour values, so the function the
   * unit test was happily calling had already been dropped by the compiler.
   *
   * So this asks Tailwind instead. `source(none)` plus `@source inline(...)`
   * makes the run hermetic — no filesystem scan, no app fixture, no dependency
   * on what happens to be in `apps/` — while still driving the same code path
   * a real build does, which is the only path where this defect is visible.
   */
  const compile = async (candidates: string): Promise<string> => {
    const { default: postcss } = await import("postcss");
    const { default: tailwind } = await import("@tailwindcss/postcss");
    const result = await postcss([tailwind()]).process(
      `@import "tailwindcss" source(none);\n` +
        `@config "./tailwind.config.ts";\n` +
        `@source inline("${candidates}");\n`,
      { from: fileURLToPath(new URL("./probe.css", import.meta.url)) },
    );
    return result.css;
  };

  it("emits a plain var() when no modifier is used", async () => {
    const css = await compile("bg-primary");
    expect(css).toMatch(
      /\.bg-primary\s*\{\s*background-color:\s*var\(--primary\);\s*\}/,
    );
  });

  it("emits a color-mix when a modifier is used", async () => {
    const css = await compile("bg-primary/15");
    // The opaque `var()` stays as the fallback declaration, so below the
    // `color-mix` floor the fill degrades to the un-modified colour rather than
    // to nothing — which is what the v3 helper did.
    expect(css).toMatch(/\.bg-primary\\\/15\s*\{\s*background-color:\s*var\(--primary\)/);
    expect(css).toContain(
      "color-mix(in oklab, var(--primary) 15%, transparent)",
    );
  });

  it("compiles the status tints to plain var() reads, with no color-mix floor", async () => {
    // #2376. An alpha modifier's fallback is the solid hue, which for the §5
    // tint recipe is the text's own colour. The tint tokens exist so that no
    // status fill depends on `color-mix` support at all.
    const css = await compile(
      "bg-success-tint bg-warning-tint bg-destructive-tint bg-destructive-tint-hover",
    );
    for (const token of [
      "success-tint",
      "warning-tint",
      "destructive-tint",
      "destructive-tint-hover",
    ]) {
      expect(css).toMatch(
        new RegExp(
          `\\.bg-${token}\\s*\\{\\s*background-color:\\s*var\\(--${token}\\);\\s*\\}`,
        ),
      );
    }
    // Scoped to the tint rules: Tailwind's own base layer uses color-mix.
    expect(css).not.toMatch(/\.bg-[\w-]*-tint[\w-]*[^{}]*\{[^}]*color-mix/);
  });

  it("uses a percentage modifier as-is", async () => {
    // `bg-primary/[62%]`. Multiplying would give `calc(62% * 100%)`, which is
    // not a valid product, so the browser drops the declaration entirely — the
    // silent no-colour failure this whole file exists to prevent.
    const css = await compile("bg-primary/[62%]");
    expect(css).toContain(
      "color-mix(in oklab, var(--primary) 62%, transparent)",
    );
  });

  it("still fades a gradient stop rather than painting a flat block", async () => {
    // v3 synthesised the implicit transparent end-stop of `from-*` by calling
    // the colour function with the NUMBER 0, and a truthiness check there
    // turned the fade into a flat block. v4 owns that end-stop, so the guard is
    // now that the stop reads the token at all.
    const css = await compile("from-primary");
    expect(css).toMatch(/\.from-primary\s*\{[^}]*--tw-gradient-from:\s*var\(--primary\)/);
  });

  it("colours every key the preset owns, not just the one probed", async () => {
    // The failure mode is per-key, so probing `primary` alone would not have
    // caught a single mis-typed value. These are the semantic families the
    // shared preset is responsible for on both surfaces.
    const css = await compile(
      "bg-card text-foreground border-border bg-secondary text-muted-foreground bg-destructive bg-success bg-accent bg-popover ring-ring",
    );
    for (const [cls, token] of [
      ["bg-card", "--card"],
      ["text-foreground", "--foreground"],
      ["border-border", "--border"],
      ["bg-secondary", "--secondary"],
      ["text-muted-foreground", "--muted-foreground"],
      ["bg-destructive", "--destructive"],
      ["bg-success", "--success"],
      ["bg-accent", "--accent"],
      ["bg-popover", "--popover"],
    ] as const) {
      expect(css, `${cls} compiled to nothing`).toContain(`var(${token})`);
    }
  });
});

/**
 * The boundary #2371 deliberately did NOT collapse.
 *
 * That issue moved every key both Next surfaces bind into this preset. Two
 * families stayed app-local on purpose, and until now nothing asserted it:
 * `signet.spec.ts` guards the §7 amendment against `signet.ts`'s emitted CSS
 * variables, which is a different file and a different failure. The risk the
 * consolidation introduces is the mirror of the one it removed — a later
 * "tidy-up" sweeping the last two remainders up here too, which would put a
 * 72px marketing headline one import away from every product screen.
 *
 * Asserted from the real configs rather than restated, so a key that moves
 * fails here instead of being discovered on a screen.
 */
describe("the surface-specific keys stay out of the shared preset (#2371)", () => {
  const fontSize = (config.theme?.extend?.fontSize ?? {}) as Record<
    string,
    unknown
  >;
  const colors = (config.theme?.extend?.colors ?? {}) as Record<
    string,
    unknown
  >;

  it("carries all six of foundations §7's locked type roles", () => {
    expect(Object.keys(fontSize).sort()).toEqual([
      "body",
      "caption",
      "display",
      "headline",
      "label",
      "title",
    ]);
  });

  it("carries none of the landing's three marketing type roles", () => {
    // `foundations.md` §7 Amendment and `design-system/README.md` §3 rule 4:
    // these sit ABOVE the locked scale and are `apps/landing`'s alone.
    for (const role of ["hero", "display-lg", "lead"]) {
      expect(
        fontSize,
        `${role} is a landing-only marketing role and must not be in the preset`,
      ).not.toHaveProperty(role);
    }
  });

  it("does not carry the web-only `gold` family", () => {
    // The Ask pill is an `apps/web` treatment; `apps/landing` implements no
    // such control, so binding it here would claim a treatment it does not draw.
    expect(colors).not.toHaveProperty("gold");
  });

  it("leaves each remainder in the app config that owns it", () => {
    // The other half of the boundary: a key deleted from an app config without
    // landing anywhere is #1145's silent no-colour failure, which reads
    // identically to a successful move.
    const web = readConfigCode(WEB_TAILWIND);
    const landing = readConfigCode(LANDING_TAILWIND);

    // Matched as the BINDING, not as the bare token name. Both configs are
    // comment-heavy and each discusses the other's remainder in prose, so
    // `toContain("--text-hero")` would be satisfied by a sentence about it —
    // and by the `--text-hero-line` sibling, which would let the size token be
    // renamed out from under `text-hero` with the guard still green.
    for (const token of [
      "--gold-house",
      "--gold-on-house",
      "--gold-ask-fill",
      "--gold-ask-border",
      "--gold-ask-text",
    ]) {
      expect(web, `apps/web must still bind ${token}`).toContain(
        `colorVar("${token}")`,
      );
    }
    expect(landing).not.toContain("colorVar(");

    for (const token of ["--text-hero", "--text-display-lg", "--text-lead"]) {
      expect(landing, `apps/landing must still bind ${token}`).toContain(
        `var(${token})`,
      );
      expect(web, `${token} is landing-only and must not reach apps/web`).not.toContain(
        `var(${token})`,
      );
    }
  });

  it("keeps a colour key out of the landing config, where the scan is now blind", () => {
    // `signet.css.spec.ts`'s per-app scan greps for the literal
    // `colorVar("--x")`. #2371 took the last colour out of this config and its
    // `colorVar` import with it, so the next colour added here would most
    // likely be written as a bare `var(--x)` — invisible to that scan, never
    // checked against `signet.css`, and #1145's silent no-fill if the token is
    // undefined. That is the defect #1423 fixed twice; it must not become
    // reachable again behind a green suite.
    const landing = readConfigCode(LANDING_TAILWIND);
    expect(
      landing,
      "a colour key here needs `colorVar` so signet.css.spec.ts can see it",
    ).not.toMatch(/^\s*colors\s*:/m);
  });
});

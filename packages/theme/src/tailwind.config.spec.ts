import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveSignetPalette,
  signetAccentSemanticVars,
} from "@repo/chapter-theme";
import { describe, expect, it } from "vitest";

import config from "./tailwind.config";

/**
 * The contract between `globals.css` and the shared Tailwind preset.
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

const GLOBALS = fileURLToPath(new URL("./globals.css", import.meta.url));
const css = readFileSync(GLOBALS, "utf8");

// ── globals.css ──────────────────────────────────────────────────────────────

/** `--token` → declared value, for one selector block of `globals.css`. */
function declaredIn(selector: string): Map<string, string> {
  const block = css.match(
    new RegExp(`^\\s*${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)^\\s*\\}`, "m"),
  );
  if (!block?.[1]) throw new Error(`globals.css has no ${selector} block`);

  const declarations = new Map<string, string>();
  for (const [, name, value] of block[1].matchAll(
    /^\s*(--[\w-]+):\s*([^;]+);/gm,
  )) {
    declarations.set(name!, value!.trim());
  }
  return declarations;
}

const root = declaredIn(":root");
const dark = declaredIn(".dark");

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
 * rather than waved through. Literal colors — the `navy` and `emerald` legacy
 * brand scales — reference no property and are skipped.
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
const COMPLETE_COLOR = /^(#[0-9a-f]{3,8}|(hsla?|rgba?)\([^)]*\))$/i;

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
      `the preset reads ${token} but globals.css :root never defines it — ` +
        "the class will compile to nothing (#1145)",
    ).toBe(true);
  });

  it("defines nothing in .dark that :root omits", () => {
    // A dark-only token is undefined in light mode, which is the same silent
    // failure by a different route.
    for (const token of dark.keys()) {
      expect(root.has(token), `${token} is defined in .dark but not in :root`).toBe(true);
    }
  });

  it("defines every referenced radius and shadow", () => {
    const { borderRadius, boxShadow } = config.theme!.extend!;
    for (const [group, values] of Object.entries({ borderRadius, boxShadow })) {
      for (const [key, value] of Object.entries(values as Record<string, string>)) {
        const token = String(value).match(/var\((--[\w-]+)\)/)?.[1];
        expect(token, `${group}.${key} should read a custom property`).toBeDefined();
        expect(root.has(token!), `${group}.${key} reads undefined ${token}`).toBe(true);
      }
    }
    // `fontFamily` is deliberately not checked: `--font-geist-sans` is injected
    // by the consuming app's Next font loader, not by this stylesheet.
  });
});

describe("token format matches how the preset reads it", () => {
  it.each(references)("$token is stored as a $style value", ({ token, style }) => {
    const pattern = style === "triple" ? HSL_TRIPLE : COMPLETE_COLOR;
    for (const [selector, declarations] of [
      [":root", root],
      [".dark", dark],
    ] as const) {
      const value = declarations.get(token);
      if (value === undefined) continue; // .dark legitimately inherits from :root
      expect(
        value,
        `${selector} defines ${token} as "${value}", but the preset reads it as a ` +
          `${style} value. A mismatch here renders nothing at all (#1143).`,
      ).toMatch(pattern);
    }
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
   * `globals.css` used to wrap tokens itself in its own base and components
   * layers (`* { border-color: hsl(var(--border)) }`), and so did app code —
   * three class names in `apps/web`'s dashboard shell and two SVG `fill`s in
   * `apps/landing`'s lockup. Every one of them hard-coded the bare-triple
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
   * complete-colour token `globals.css` declares — *not* only the ones the
   * preset reads. Some of this file's own tokens are consumed exclusively by
   * hand, never through a Tailwind colour key: `--brand-lockup-bg` is one (an
   * SVG `fill` in `apps/landing`, and one of the very sites the #1151 sweep
   * fixed). Keying on `references` would have left exactly those unguarded —
   * the token's storage format is what makes the wrapper wrong, so storage is
   * what the guard keys on.
   *
   * The `--hue-*` family used to be named here as the second example. #1155
   * deleted those five: they were hand-consumable in principle and consumed by
   * nothing in fact, which is a token to remove rather than a token to guard.
   */
  const REPO = fileURLToPath(new URL("../../..", import.meta.url));
  const WRAPPER = /hsl\(\s*var\(\s*(--[\w-]+)/g;
  const SCANNED = /\.(tsx?|css)$/;
  const SKIP = new Set(["node_modules", ".next", ".expo", "dist", "build", ".turbo"]);

  /**
   * Walks by hand rather than with `readdirSync(dir, { recursive: true })`:
   * that option needs Node >= 20.1, and `package.json` declares `>=20`. On an
   * older runtime the option is ignored rather than rejected, so the scan would
   * quietly flatten to one directory level.
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
    { file: GLOBALS, text: css },
    ...appSources.map((file) => ({ file, text: readFileSync(file, "utf8") })),
  ];

  /** Every token this stylesheet stores as a complete colour, in either block. */
  const completeTokens = new Set(
    [...root, ...dark]
      .filter(([, value]) => COMPLETE_COLOR.test(value))
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
    // The regression this guard was widened to catch. `--brand-lockup-bg` is
    // the witness: hand-consumed only (an SVG `fill` in `apps/landing`), so a
    // set keyed on `references` would not contain it.
    //
    // It is the ONLY witness now that #1155 deleted the `--hue-*` family, which
    // is why this is a named assertion rather than a token-agnostic one. A
    // count or a size comparison looks more general and is not: today it would
    // be this same token by another name, and it would additionally go red on a
    // correct change — wiring `--brand-lockup-bg` into a preset colour key, or
    // adding any bare-triple preset key — with a message about set sizes that
    // says nothing about what actually broke. If this token stops being
    // hand-consumed, retarget this deliberately rather than quietly narrowing
    // back to `references`.
    expect(completeTokens.has("--brand-lockup-bg")).toBe(true);
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
      "every colour token in globals.css is stored as a complete colour, so " +
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
   * `border-destructive/45`, `bg-success/15` and friends. Under v3 the preset
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

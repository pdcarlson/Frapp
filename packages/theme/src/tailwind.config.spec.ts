import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { derivePalette } from "@repo/chapter-theme";
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
 *  - #1143: per-chapter accents are persisted as **hex** by `derivePalette()`,
 *    but the preset wrapped the same token names in `hsl(...)`, so an injected
 *    `--side-accent: #C49A3A` became the invalid `hsl(#C49A3A)`.
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
 * A string value wrapping the property in `hsl(...)` needs a bare HSL triple on
 * the other side; a function value (`colorVar`) emits the property directly and
 * so needs a complete color. Literal colors — the `navy` / `royal-blue` /
 * `emerald` brand scales — reference no property and are skipped.
 */
function scanColors(): { references: Reference[]; unrecognised: string[] } {
  const references: Reference[] = [];
  const unrecognised: string[] = [];

  const visit = (node: unknown, key: string): void => {
    if (typeof node === "function") {
      // Called the way Tailwind calls it for an un-modified utility.
      const emitted = String((node as (arg?: unknown) => unknown)());
      const token = emitted.match(/^var\((--[\w-]+)\)$/)?.[1];
      if (token) references.push({ key, token, style: "complete" });
      else unrecognised.push(`${key} is a function but emitted "${emitted}", not a bare var()`);
      return;
    }
    if (typeof node === "string") {
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
   * a literal cannot notice that. `derivePalette()` persists every key below to
   * `chapters.theme_palette` as hex, and `use-chapter-theme.ts` writes them onto
   * `:root` — so the moment one of them is also read by the preset, it must be
   * read in a form that accepts hex. Deriving both halves means a new palette
   * token, or a new preset key for an existing one, is covered on arrival.
   *
   * The devDependency is test-only and acyclic: `@repo/chapter-theme` does not
   * import `@repo/theme`.
   */
  const chapterTokens = Object.keys(
    derivePalette({ dark: "#8B0000", accent: "#C9A56F" }).palette,
  );
  const readByPreset = chapterTokens.filter((token) =>
    references.some((r) => r.token === token),
  );

  it("still finds the overlap it is meant to police", () => {
    // If the intersection empties out — the engine renames its tokens, the
    // preset drops the keys — every assertion below passes by describing
    // nothing. That is the one way this guard can fail silently.
    expect(chapterTokens.length).toBeGreaterThan(0);
    expect(readByPreset).toEqual(
      expect.arrayContaining(["--side-bg", "--side-accent", "--ring"]),
    );
  });

  it.each(readByPreset)("%s is read in a hex-compatible form", (token) => {
    for (const { key, style } of references.filter((r) => r.token === token)) {
      expect(
        style,
        `${key} reads ${token} as an HSL triple, but the accent engine persists ` +
          `${token} as hex — it would resolve to hsl(#RRGGBB) and be dropped by ` +
          "the browser (#1143). Either store it as a complete colour and read it " +
          "through colorVar(), or stop writing it from derivePalette().",
      ).toBe("complete");
    }
  });

  it("still renders a chapter's hex through the preset", () => {
    const accent = config.theme!.extend!.colors as Record<string, unknown>;
    const side = accent["side"] as Record<string, (arg?: unknown) => string>;
    expect(side["accent"]!()).toBe("var(--side-accent)");
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
   * that option needs Node >= 20.1, and `package.json` declares `>=18`. On an
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
    // the named witness: hand-consumed only, so a set keyed on `references`
    // would not contain it. If it ever stops being hand-consumed, retarget this
    // deliberately rather than quietly narrowing back to `references`.
    expect(completeTokens.has("--brand-lockup-bg")).toBe(true);

    // The same invariant stated without naming a token, so that deleting an
    // unused one can never leave this test asserting nothing. It held with the
    // `--hue-*` family present and still holds with those five gone (#1155):
    // the scanned set must stay strictly wider than what the preset reads.
    const presetTokens = new Set(references.map((reference) => reference.token));
    expect(completeTokens.size).toBeGreaterThan(presetTokens.size);
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
  // 14 live classes depend on this — `bg-side-bg-hi/70`, `ring-side-accent/70`,
  // `border-side-accent/30` and friends. A bare `var()` cannot take a Tailwind
  // opacity modifier, so dropping `color-mix` here would silently uncolor them.
  const side = (config.theme!.extend!.colors as Record<string, unknown>)[
    "side"
  ] as Record<string, (arg?: unknown) => string>;

  it("emits a plain var() when no modifier is used", () => {
    expect(side["bg-hi"]!({ opacityValue: "var(--tw-bg-opacity, 1)" })).toBe(
      "var(--side-bg-hi)",
    );
  });

  it("emits a color-mix when a modifier is used", () => {
    expect(side["bg-hi"]!({ opacityValue: "0.7" })).toBe(
      "color-mix(in srgb, var(--side-bg-hi) calc(0.7 * 100%), transparent)",
    );
  });

  it("uses a percentage modifier as-is", () => {
    // `bg-side-bg-hi/[62%]`. Multiplying would give `calc(62% * 100%)`, which is
    // not a valid product, so the browser drops the declaration entirely — the
    // silent no-colour failure this whole file exists to prevent.
    expect(side["bg-hi"]!({ opacityValue: "62%" })).toBe(
      "color-mix(in srgb, var(--side-bg-hi) 62%, transparent)",
    );
  });

  it("honours the numeric 0 that gradient stops pass", () => {
    // `gradientColorStops` synthesises the implicit transparent end-stop of
    // `from-*` / `via-*` by calling with the NUMBER 0. A truthiness check would
    // treat that as "no modifier" and emit an opaque stop, so
    // `bg-gradient-to-t from-side-bg` would render a flat block instead of a
    // fade.
    expect(side["bg"]!({ opacityValue: 0 })).toBe(
      "color-mix(in srgb, var(--side-bg) calc(0 * 100%), transparent)",
    );
  });
});

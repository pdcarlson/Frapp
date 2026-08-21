import { readFileSync } from "node:fs";
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

describe("hand-written hsl(var(--x)) agrees with the token's stored format", () => {
  // The preset is not the only reader. `globals.css` wraps tokens itself in its
  // own base and components layers (`* { border-color: hsl(var(--border)) }`),
  // and those sites hard-code the bare-triple assumption exactly as the preset
  // used to. While one convention covered everything this could not go wrong;
  // now that two coexist, a token converted for the preset would leave these
  // emitting `hsl(hsl(30 10% 12%))` — invalid, and dropped.
  const wrapped = [...css.matchAll(/hsl\(var\((--[\w-]+)\)/g)].map((m) => m[1]!);
  const completeTokens = new Set(
    references.filter((r) => r.style === "complete").map((r) => r.token),
  );

  it("finds the hand-written wrappers it is checking", () => {
    expect(new Set(wrapped).size).toBeGreaterThan(0);
  });

  it.each([...new Set(wrapped)])("%s is stored as a triple", (token) => {
    expect(
      completeTokens.has(token),
      `globals.css writes hsl(var(${token})) by hand, but the preset reads ` +
        `${token} as a complete colour — one of the two is now wrong, and the ` +
        "hand-written one renders nothing.",
    ).toBe(false);
    const value = root.get(token);
    if (value !== undefined) expect(value).toMatch(HSL_TRIPLE);
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

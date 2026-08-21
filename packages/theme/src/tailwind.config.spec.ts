import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
function colorReferences(): Reference[] {
  const found: Reference[] = [];

  const visit = (node: unknown, key: string): void => {
    if (typeof node === "function") {
      // Called the way Tailwind calls it for an un-modified utility.
      const emitted = String((node as (arg?: unknown) => unknown)());
      const token = emitted.match(/^var\((--[\w-]+)\)$/)?.[1];
      expect(token, `${key} is a function but did not emit a bare var()`).toBeDefined();
      found.push({ key, token: token!, style: "complete" });
      return;
    }
    if (typeof node === "string") {
      const wrapped = node.match(/^hsl\(var\((--[\w-]+)\)\)$/);
      if (wrapped) found.push({ key, token: wrapped[1]!, style: "triple" });
      else expect(node, `${key} references a var in an unrecognised form`).not.toMatch(/var\(/);
      return;
    }
    for (const [child, value] of Object.entries(node as object)) {
      visit(value, `${key}.${child}`);
    }
  };

  visit(config.theme!.extend!.colors, "colors");
  return found;
}

const references = colorReferences();

const HSL_TRIPLE = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;
const COMPLETE_COLOR = /^(#[0-9a-f]{3,8}|(hsla?|rgba?)\([^)]*\))$/i;

// ── Assertions ───────────────────────────────────────────────────────────────

describe("every token the preset reads is defined", () => {
  it("has at least the colors we expect to find", () => {
    // Guards the walker itself: a parse that quietly found nothing would make
    // every assertion below vacuous.
    expect(references.length).toBeGreaterThan(20);
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
   * `derivePalette()` in `@repo/chapter-theme` persists these to
   * `chapters.theme_palette` as hex and `apps/web/lib/hooks/use-chapter-theme.ts`
   * writes them onto `:root`. They are the intersection of that palette with
   * the keys this preset owns — the exact set #1143 was about. Named here
   * rather than imported so this package keeps no dependency on the engine.
   */
  const CHAPTER_WRITTEN = ["--side-bg", "--side-accent", "--ring"];

  it.each(CHAPTER_WRITTEN)("%s is read in a hex-compatible form", (token) => {
    const reading = references.filter((r) => r.token === token);
    expect(reading.length, `no preset key reads ${token}`).toBeGreaterThan(0);
    for (const { key, style } of reading) {
      expect(
        style,
        `${key} reads ${token} as an HSL triple, so the hex the accent engine ` +
          "stores would resolve to hsl(#RRGGBB) and be dropped by the browser",
      ).toBe("complete");
    }
  });

  it("still renders a chapter's hex through the preset", () => {
    const accent = config.theme!.extend!.colors as Record<string, unknown>;
    const side = accent["side"] as Record<string, (arg?: unknown) => string>;
    expect(side["accent"]!()).toBe("var(--side-accent)");
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
});

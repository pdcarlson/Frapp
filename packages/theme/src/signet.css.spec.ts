import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveSignetPalette, signetAccentSemanticVars } from "@repo/chapter-theme";
import { describe, expect, it } from "vitest";

import { getSignetCssVars } from "./signet";
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
  for (const [, name, value] of block[1].matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    declarations.set(name!, value!.replace(/\s+/g, " ").trim());
  }
  return declarations;
}

const root = declaredIn(css);

const COMPLETE_COLOR = /^(#[0-9a-f]{3,8}|(hsla?|rgba?)\([^)]*\))$/i;

/** Every custom property a config's color keys read through `colorVar`. */
function tokensReadBy(colors: unknown): string[] {
  const tokens: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === "function") {
      const emitted = String((node as (arg?: unknown) => unknown)());
      const token = emitted.match(/^var\((--[\w-]+)\)$/)?.[1];
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
    for (const key of ["--shadow-xs", "--shadow-sm", "--shadow", "--shadow-lg"]) {
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

  it.each(referenced)("%s is defined in signet.css as a complete color", (token) => {
    const value = root.get(token);
    expect(
      value,
      `a Tailwind color key reads ${token} but signet.css never defines it — ` +
        "on the Signet surface the class compiles to nothing (#1145)",
    ).toBeDefined();
    expect(value).toMatch(COMPLETE_COLOR);
  });

  it("defines every radius token the preset reads", () => {
    for (const value of Object.values(
      config.theme!.extend!.borderRadius as Record<string, string>,
    )) {
      const token = String(value).match(/var\((--[\w-]+)\)/)?.[1];
      expect(token).toBeDefined();
      expect(root.has(token!), `signet.css must define ${token}`).toBe(true);
    }
  });
});

describe("each surface imports exactly its own system", () => {
  // The freeze boundary as a test: `apps/web` is Signet, `apps/landing` stays
  // legacy until its own reskin. An import swap on either side silently
  // reskins a surface it must not touch.
  const web = readFileSync(WEB_GLOBALS, "utf8");
  const landing = readFileSync(LANDING_GLOBALS, "utf8");

  it("apps/web imports signet.css and not the legacy stylesheet", () => {
    expect(web).toMatch(/@import\s+"[^"]*packages\/theme\/src\/signet\.css"/);
    expect(web).not.toMatch(/globals\.css"/);
  });

  it("apps/landing imports the legacy stylesheet and not signet.css", () => {
    expect(landing).toMatch(/@import\s+"[^"]*packages\/theme\/src\/globals\.css"/);
    expect(landing).not.toMatch(/signet\.css/);
  });
});

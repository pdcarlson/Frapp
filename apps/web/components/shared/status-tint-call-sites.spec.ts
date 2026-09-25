import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #2376: no Next surface draws a semantic status fill as an alpha utility, and
 * no danger label sits on the danger tint in the unlifted hue.
 *
 * `bg-success/[.13]` looks like foundations §5's tint recipe and renders like
 * it in a current browser. Tailwind v4 compiles it to a `color-mix()` behind
 * `@supports`, though, with the SOLID hue as the fallback declaration, so
 * below the `color-mix` floor (Chrome 111, Safari 16.2, Firefox 113) the fill
 * turned into the text's own colour and every status label on the dashboard
 * read 1.00:1. The recipe has tokens instead (`bg-success-tint`,
 * `bg-warning-tint`, `bg-destructive-tint`, `bg-destructive-tint-hover`),
 * which are `rgba()` literals with no floor, and this scan keeps the alpha
 * shape from coming back.
 *
 * It matches the `/` after the family, so every spelling of an opacity
 * (`/15`, `/[.13]`, `/[0.13]`, `/[13%]`) and every variant prefix (`hover:`,
 * `data-[state=active]:`) is caught. Borders are not: a border's fallback is
 * a bolder border with nothing drawn in its colour on top of it.
 */

const REPO = join(__dirname, "..", "..", "..", "..");
/** Where product code lives in each Next app; `tests/` is harness code. */
const ROOTS = [
  "apps/web/app",
  "apps/web/components",
  "apps/web/hooks",
  "apps/web/lib",
  "apps/landing/app",
  "apps/landing/components",
  "apps/landing/lib",
];
const SOURCE = /\.tsx?$/;
const SPEC = /\.(spec|test)\.tsx?$/;

/** A semantic status family's background, followed by an opacity modifier. */
export const ALPHA_STATUS_FILL =
  /(?<![\w-])bg-(success|warning|destructive|info)\/[\w.[\]%]+/g;

/**
 * `withFileTypes`, as in `lib/date-call-sites.spec.ts`, so a dangling symlink
 * is skipped rather than crashing the suite. A root that stops existing throws
 * instead of being skipped, because a scan of nothing passes forever.
 */
function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      found.push(...walk(path));
    } else if (entry.isFile() && SOURCE.test(entry.name)) {
      if (!SPEC.test(entry.name)) found.push(path);
    }
  }
  return found;
}

function sourceFiles(): string[] {
  return ROOTS.flatMap((root) => walk(join(REPO, root))).sort();
}

/**
 * Comments are dropped before matching: prose may name the banned shape to
 * explain why a line does not use it (the landing's danger chip does).
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Every string literal in a source, each a candidate class list. */
const STRING_LITERAL = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\]*)`/g;

/**
 * A class's variants and its utility: `enabled:group-[.destructive]:hover:x`
 * is `["enabled", "group-[.destructive]", "hover"]` and `x`. Colons inside an
 * arbitrary value's brackets are part of the variant, not separators.
 */
function parseClass(cls: string): { variants: string[]; utility: string } {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of cls) {
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (char === ":" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  return { variants: parts, utility: current };
}

/** The danger tint as a fill, or as an image over an opaque base (the toast). */
const DANGER_TINT =
  /^(?:bg-destructive-tint(?:-hover)?|bg-\[linear-gradient\(var\(--destructive-tint(?:-hover)?\).*\])$/;
const DANGER_TEXT = new Set(["text-destructive", "text-destructive-text"]);

/**
 * The unlifted danger text a class list paints on the danger tint. Solid
 * `--destructive` misses the gate on its own tint from `--surface-1` up, so
 * danger text on the tint is `--destructive-text` (foundations §5).
 *
 * A tint under some variants takes its text from the most specific danger
 * text whose variants are a subset of its own, which is how the cascade
 * resolves them: `data-[state=active]:bg-destructive-tint` with no text of its
 * own inherits the list's bare `text-destructive`, and the toast action's
 * `enabled:group-[.destructive]:hover:` tint inherits the
 * `enabled:group-[.destructive]:` text.
 */
export function unliftedDangerOnTint(classList: string): string[] {
  const parsed = classList
    .split(/\s+/)
    .filter(Boolean)
    .map((cls) => ({
      cls,
      ...parseClass(cls),
    }));
  const texts = parsed.filter((c) => DANGER_TEXT.has(c.utility));
  const found: string[] = [];
  for (const tint of parsed.filter((c) => DANGER_TINT.test(c.utility))) {
    const applicable = texts.filter((text) =>
      text.variants.every((v) => tint.variants.includes(v)),
    );
    const depth = Math.max(-1, ...applicable.map((t) => t.variants.length));
    const winners = applicable.filter((t) => t.variants.length === depth);
    for (const text of winners) {
      if (text.utility === "text-destructive") {
        found.push(`${tint.cls} under ${text.cls}`);
      }
    }
  }
  return found;
}

describe("semantic status fills are tint tokens, never an alpha utility (#2376)", () => {
  const files = sourceFiles();

  it("is reading the real sources, not an empty tree", () => {
    // A path that stopped resolving would pass the scan below forever.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.endsWith("components/ui/badge.tsx"))).toBe(
      true,
    );
  });

  it("still recognises every spelling it bans", () => {
    const probe = [
      "bg-success/[.13]",
      "bg-warning/15",
      "hover:bg-destructive/20",
      "data-[state=active]:bg-destructive/[0.13]",
      "bg-info/[13%]",
    ].join(" ");
    expect(probe.match(ALPHA_STATUS_FILL)).toHaveLength(5);
    // And leaves alone what it must not ban.
    expect(
      "border-destructive/45 bg-destructive-tint hover:bg-destructive-tint-hover".match(
        ALPHA_STATUS_FILL,
      ),
    ).toBeNull();
  });

  it("finds no alpha status fill in any Next surface", () => {
    const offenders = files.flatMap((file) =>
      (
        withoutComments(readFileSync(file, "utf8")).match(ALPHA_STATUS_FILL) ??
        []
      ).map((match) => `${relative(REPO, file)}: ${match}`),
    );
    expect(
      offenders,
      "use the tint token (bg-<family>-tint); an alpha fill falls back to " +
        "the solid hue below the color-mix floor and hides same-hue text",
    ).toEqual([]);
  });

  it("still recognises unlifted danger text on the tint", () => {
    const flagged = [
      "bg-destructive-tint text-destructive",
      "text-destructive data-[state=active]:bg-destructive-tint data-[state=active]:text-destructive",
      "text-destructive data-[state=active]:bg-destructive-tint",
      // A shorter variant prefix is still the text a longer one inherits.
      "enabled:group-[.destructive]:text-destructive enabled:group-[.destructive]:hover:bg-destructive-tint-hover",
      "bg-popover bg-[linear-gradient(var(--destructive-tint),var(--destructive-tint))] text-destructive",
    ];
    for (const classList of flagged) {
      expect(unliftedDangerOnTint(classList), classList).toHaveLength(1);
    }
    // And leaves the shipped shapes alone.
    const clean = [
      "bg-destructive-tint text-destructive-text hover:bg-destructive-tint-hover",
      "text-destructive data-[state=active]:bg-destructive-tint data-[state=active]:text-destructive-text",
      "enabled:group-[.destructive]:text-destructive-text enabled:group-[.destructive]:hover:bg-popover enabled:group-[.destructive]:hover:bg-[linear-gradient(var(--destructive-tint-hover),var(--destructive-tint-hover))]",
      // Text from a child element is out of this scan's reach, not a failure.
      "border-destructive/45 bg-destructive-tint p-3",
    ];
    for (const classList of clean) {
      expect(unliftedDangerOnTint(classList), classList).toEqual([]);
    }
  });

  it("finds no danger label on the danger tint in the unlifted hue", () => {
    const offenders = files.flatMap((file) =>
      [...withoutComments(readFileSync(file, "utf8")).matchAll(STRING_LITERAL)]
        .flatMap((m) => unliftedDangerOnTint(m[1] ?? m[2] ?? m[3] ?? ""))
        .map((hit) => `${relative(REPO, file)}: ${hit}`),
    );
    expect(
      offenders,
      "danger text on the danger tint is text-destructive-text (foundations §5)",
    ).toEqual([]);
  });
});

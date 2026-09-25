import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #2376: no Next surface draws a semantic status fill as an alpha utility.
 *
 * `bg-success/[.13]` looks like foundations §5's tint recipe and renders like
 * it in a current browser. Tailwind v4 compiles it to a `color-mix()` behind
 * `@supports`, though, with the SOLID hue as the fallback declaration, so
 * below the `color-mix` floor (Chrome 111, Safari 16.2, Firefox 113) the fill
 * turned into the text's own colour and every status label on the dashboard
 * read 1.00:1. The recipe has opaque tokens instead (`bg-success-tint`,
 * `bg-warning-tint`, `bg-destructive-tint`, `bg-destructive-tint-hover`), and
 * this scan keeps the alpha shape from coming back.
 *
 * It matches the `/` after the family, so every spelling of an opacity
 * (`/15`, `/[.13]`, `/[0.13]`, `/[13%]`) and every variant prefix (`hover:`,
 * `data-[state=active]:`) is caught. Borders are not: a `border-destructive/45`
 * fallback is a bolder border, which is cosmetic and accepted.
 */

const REPO = join(__dirname, "..", "..", "..", "..");
const ROOTS = [
  "apps/web/app",
  "apps/web/components",
  "apps/web/lib",
  "apps/landing/app",
  "apps/landing/components",
];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage"]);
const SOURCE = /\.(tsx|ts)$/;
const SPEC = /\.spec\.(tsx|ts)$/;

/** A semantic status family's background, followed by an opacity modifier. */
export const ALPHA_STATUS_FILL =
  /(?<![\w-])bg-(success|warning|destructive|info)\/[\w.[\]%]+/g;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (SOURCE.test(name) && !SPEC.test(name)) out.push(path);
    }
  };
  for (const root of ROOTS) walk(join(REPO, root));
  return out.sort();
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

describe("semantic status fills are opaque tokens, never an alpha utility (#2376)", () => {
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
      "use the opaque tint token (bg-<family>-tint); an alpha fill falls back " +
        "to the solid hue below the color-mix floor and hides same-hue text",
    ).toEqual([]);
  });
});

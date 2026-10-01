import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The call-site half of `elevation-contrast.spec.ts` (#1270).
 *
 * That file proves the token math, and like every value-level guard here it
 * stays green through a full revert of the code it was written for:
 * `family-call-sites.spec.ts` opens with the same lesson. This file reads the
 * source instead.
 *
 * **The alias ban.** `--accent` and `--secondary` hold exactly `--popover`'s and
 * `--card`'s values (`signet.css`), and the names hide it. `hover:bg-accent`
 * reads like a highlight and is the elevated step itself, so inside a dialog
 * or sheet it painted a control in its container's own colour: the Secondary
 * button (#1220), the notification drawer's rows (#1208), and before them a
 * dialog's role rows, a card's coordinate list and `/polls`' meter track, each
 * found on a screenshot rather than by a guard.
 *
 * A rule keyed on the container ("no `bg-accent` on a `--popover`") is what the
 * issue first asked for, and a regex cannot evaluate it. It also isn't needed:
 * the alias is never the honest spelling, because writing the surface you mean
 * (`bg-popover`, `bg-card`) says the same thing in a way review can read. So
 * the four alias names are banned outright, under every colour utility, every
 * variant prefix and every opacity spelling, across both Next surfaces. A flat
 * ban has no false positives to manage, so this walks the source tree rather
 * than keeping a ledger: a ledger would miss the next new file.
 *
 * Shape borrowed from `status-tint-call-sites.spec.ts`: the same roots, the
 * same walker, comments stripped first (the docstrings explaining a rule quote
 * the very classes it bans).
 */

const REPO = join(__dirname, "..", "..", "..", "..");
const WEB = join(REPO, "apps", "web");
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

/**
 * `withFileTypes`, as in `status-tint-call-sites.spec.ts`, so a dangling
 * symlink is skipped rather than crashing the suite. A root that stops
 * existing throws instead of being skipped, because a scan of nothing passes
 * forever.
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

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/**
 * A colour utility of one of the four alias tokens. The prefix list is every
 * Tailwind utility that takes a colour; the lookarounds keep `bg-accent-subtle`,
 * `bg-accent-subtle-hover`, `border-accent-border` and `text-accent-text` (the
 * chapter-accent family, which is not an alias) out, and let any variant chain
 * (`hover:`, `enabled:data-[state=unchecked]:`) and either opacity spelling
 * (`/50`, `/[.5]`) in. Matching the `/` rather than a list of known-bad pairs
 * is `family-call-sites.spec.ts`'s second lesson.
 */
export const ALIAS_UTILITY =
  /(?<![\w-])(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|divide|from|via|to|fill|stroke|decoration|caret|accent|placeholder|shadow)-(?:accent|secondary)(?:-foreground)?(?:\/[\w.[\]%]+)?(?![\w-])/g;

describe("the alias matcher", () => {
  // Proved on fixtures, so a regex edit that stops matching fails here rather
  // than turning the scan below into a check of nothing.
  it.each([
    // The four sites this change fixed, as they shipped.
    "hover:bg-accent",
    "enabled:data-[state=unchecked]:bg-accent",
    "rounded-full bg-accent text-[12.5px]",
    // The earlier ones the docstrings record, and both opacity spellings.
    "hover:bg-accent/50",
    "hover:bg-accent/[.5]",
    "bg-secondary/60",
    "data-[active]:bg-secondary",
    "text-secondary-foreground",
    "!bg-accent",
    "border-t-secondary",
  ])("flags %s", (cls) => {
    expect(cls.match(ALIAS_UTILITY)).not.toBeNull();
  });

  it.each([
    "hover:bg-accent-subtle",
    "data-[state=selected]:bg-accent-subtle-hover",
    "border-accent-border",
    "text-accent-text",
    "bg-card-hover",
    "bg-popover",
    'variant="secondary"',
    "--accent",
  ])("leaves %s alone", (cls) => {
    expect(cls.match(ALIAS_UTILITY)).toBeNull();
  });
});

describe("no Next surface paints the --accent or --secondary alias", () => {
  const files = ROOTS.flatMap((root) => walk(join(REPO, root))).sort();

  it("scans a real corpus", () => {
    // Each root is walked, and a root that moved would throw above. This is
    // the other half: the walk found the product, not an empty directory.
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain(join(WEB, "components", "ui", "button.tsx"));
  });

  it("finds none", () => {
    const hits = files.flatMap((file) =>
      [...withoutComments(readFileSync(file, "utf8")).matchAll(ALIAS_UTILITY)].map(
        (m) => `${relative(REPO, file)}: ${m[0]}`,
      ),
    );
    expect(
      hits,
      "spell the surface (`bg-popover`, `bg-card`), or a state token " +
        "(`bg-card-hover`, `bg-accent-subtle`), never the alias",
    ).toEqual([]);
  });
});

describe("global-error's hand copy of the Secondary button", () => {
  /*
   * `app/global-error.tsx` replaces the root layout and may not import the
   * component tree, so it restates `Button variant="secondary"`'s classes. The
   * first fix for #1220 had to land twice for exactly that reason, and a hover
   * changed in one and not the other is invisible to every other guard.
   * `focus-contrast.spec.ts` pins the same file's copy of `FOCUS_RING`.
   */
  const button = readFileSync(join(WEB, "components", "ui", "button.tsx"), "utf8");
  const globalError = readFileSync(join(WEB, "app", "global-error.tsx"), "utf8");
  const recipe = /\bsecondary:\s*"([^"]+)"/.exec(button)?.[1];
  const copy = /className="([^"]*\bborder-input\b[^"]*)"/.exec(globalError)?.[1];

  it("finds both strings", () => {
    expect(recipe, "button.tsx no longer has a `secondary:` variant string").toBeDefined();
    expect(copy, "global-error.tsx no longer has the Secondary button").toBeDefined();
  });

  it("carries every class of the variant", () => {
    const copied = new Set(copy!.split(/\s+/));
    const missing = recipe!.split(/\s+/).filter((cls) => !copied.has(cls));
    expect(missing).toEqual([]);
  });

  it("hovers to --card-hover", () => {
    expect(recipe).toMatch(/(?:^|\s)hover:bg-card-hover(?:\s|$)/);
  });
});

describe("the overlay close controls are text-toned (#1208)", () => {
  // The value half is in `elevation-contrast.spec.ts`: `--muted` on
  // `--popover` misses the text gate, `--muted-foreground` clears it.
  it.each(["dialog.tsx", "sheet.tsx"])("%s", (file) => {
    const source = withoutComments(
      readFileSync(join(WEB, "components", "ui", file), "utf8"),
    );
    const close = /<\w+Primitive\.Close\s+className=\{cn\(\s*"([^"]+)"/.exec(source)?.[1];
    expect(close, `${file} no longer renders a Close control`).toBeDefined();
    expect(close).toMatch(/(?:^|\s)text-muted-foreground(?:\s|$)/);
    expect(close).not.toMatch(/(?:^|\s)text-muted(?:\s|$)/);
  });
});

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { productSourceFiles, REPO, withoutComments } from "@/tests/source-scan";

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
 * the alias is never the honest spelling, because a rest fill can name the
 * ladder step it means (`bg-popover`, `bg-card`) and a hover has state tokens
 * (`bg-card-hover`, `bg-accent-subtle`). So the four alias names are banned
 * outright, in every spelling that reaches them: a colour utility at any
 * variant and opacity, an arbitrary value, a `var()` read, an `@apply`. The
 * scan covers both Next surfaces' TS and CSS (`tests/source-scan.ts`, shared
 * with `status-tint-call-sites.spec.ts`), comments stripped first, since the
 * docstrings explaining a rule quote the very classes it bans.
 *
 * A ban on a name cannot stop the same defect spelled with an honest name
 * (`hover:bg-popover` on a row in a sheet), so the hovers this change chose are
 * pinned at their call sites below as well.
 */

const WEB = join(REPO, "apps", "web");

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

/**
 * A read of an alias variable by any other route: `var(--accent)` (inline
 * style, CSS, an arbitrary value) and the bare `[--accent]` / `(--accent)`
 * shorthands Tailwind accepts for one. Declaring a variable is not a read, so
 * `--accent: …` in a stylesheet would not match; none of the scanned roots
 * declares one (they are defined only in `packages/theme/src/signet.css`).
 */
export const ALIAS_VAR =
  /[([]\s*--(?:accent|secondary)(?:-foreground)?\s*[,)\]]/g;

const aliasHits = (source: string) => [
  ...(source.match(ALIAS_UTILITY) ?? []),
  ...(source.match(ALIAS_VAR) ?? []),
];

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
    // The same alias by another road.
    "hover:bg-[var(--accent)]",
    "bg-[--accent]",
    "bg-(--secondary)",
    'style={{ background: "var(--accent)" }}',
    "background: var(--secondary, #211E1A);",
    "@apply hover:bg-accent;",
  ])("flags %s", (cls) => {
    expect(aliasHits(cls)).not.toEqual([]);
  });

  it.each([
    "hover:bg-accent-subtle",
    "data-[state=selected]:bg-accent-subtle-hover",
    "border-accent-border",
    "text-accent-text",
    "bg-[var(--accent-subtle)]",
    "var(--accent-text)",
    "bg-card-hover",
    "bg-popover",
    'variant="secondary"',
    "--accent: #2A2621;",
  ])("leaves %s alone", (cls) => {
    expect(aliasHits(cls)).toEqual([]);
  });
});

describe("no Next surface paints the --accent or --secondary alias", () => {
  const files = productSourceFiles(/\.(tsx?|css)$/);

  it("scans a real corpus, stylesheets included", () => {
    // Each root is walked, and a root that moved would throw. This is the
    // other half: the walk found the product, not an empty directory.
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain(join(WEB, "components", "ui", "button.tsx"));
    expect(files).toContain(join(WEB, "app", "globals.css"));
  });

  it("finds none", () => {
    const hits = files.flatMap((file) =>
      aliasHits(withoutComments(readFileSync(file, "utf8"))).map(
        (hit) => `${relative(REPO, file)}: ${hit}`,
      ),
    );
    expect(
      hits,
      "never the alias: a rest fill names its ladder step (`bg-popover`, " +
        "`bg-card`), and a hover takes a state token above what it sits on " +
        "(`bg-card-hover`, or §2's `bg-accent-subtle` for a row in a menu or " +
        "table). Never hover to the surface the control already sits on.",
    ).toEqual([]);
  });
});

/**
 * The double-quoted class list that rests on `fill` and states a background
 * hover: the drawer's per-state strings. Requiring the hover skips other
 * strings that merely share the fill (the "New" badge rests on accent-3 too),
 * and a row whose hover was deleted outright fails here, loudly.
 */
function hoveredClassList(source: string, fill: string): string[] {
  const literal = [...source.matchAll(/"([^"\n]*)"/g)]
    .map((m) => m[1]!.split(/\s+/).filter(Boolean))
    .find(
      (classes) =>
        classes.includes(fill) && classes.some((cls) => cls.startsWith("hover:bg-")),
    );
  expect(literal, `no class list resting on ${fill} with a hover`).toBeDefined();
  return literal!;
}

describe("the notification drawer's row hovers (#1208)", () => {
  /*
   * The drawer is a `SheetContent`, so every row sits on `--popover`. Each rest
   * fill has its own hover, measured in `elevation-contrast.spec.ts`; pinned
   * here because a hover rewritten to the sheet's own colour (`hover:bg-popover`)
   * or to the row's own rest fill uses no alias and passes the ban above.
   */
  const drawer = withoutComments(
    readFileSync(
      join(WEB, "components", "layout", "dashboard-notification-drawer.tsx"),
      "utf8",
    ),
  );

  it("lifts a read row, which rests on --card, to --card-hover", () => {
    const read = hoveredClassList(drawer, "bg-card");
    expect(read.filter((cls) => cls.startsWith("hover:bg-"))).toEqual([
      "hover:bg-card-hover",
    ]);
  });

  it("lifts an unread row, which rests on accent-3, to accent-4", () => {
    const unread = hoveredClassList(drawer, "bg-accent-subtle");
    expect(unread.filter((cls) => cls.startsWith("hover:bg-"))).toEqual([
      "hover:bg-accent-subtle-hover",
    ]);
  });
});

describe("global-error's hand copy of the Secondary button", () => {
  /*
   * `app/global-error.tsx` replaces the root layout and may not import the
   * component tree, so it restates `Button variant="secondary" size="sm"`. The
   * first fix for #1220 had to land twice for exactly that reason, and a hover
   * changed in one and not the other is invisible to every other guard.
   * `focus-contrast.spec.ts` pins the same copy's `FOCUS_RING`. The base's
   * icon and disabled classes are deliberately absent from the copy: it draws
   * no icon and is never disabled.
   */
  const button = readFileSync(join(WEB, "components", "ui", "button.tsx"), "utf8");
  const globalError = readFileSync(join(WEB, "app", "global-error.tsx"), "utf8");
  const variant = /\bsecondary:\s*"([^"]+)"/.exec(button)?.[1]?.split(/\s+/);
  const size = /\bsm:\s*"([^"]+)"/.exec(button)?.[1]?.split(/\s+/);
  const copy = /className="([^"]*\bborder-input\b[^"]*)"/
    .exec(globalError)?.[1]
    ?.split(/\s+/);

  it("finds all three strings", () => {
    expect(variant, "button.tsx has no `secondary:` variant string").toBeDefined();
    expect(size, "button.tsx has no `sm:` size string").toBeDefined();
    expect(copy, "global-error.tsx no longer has the Secondary button").toBeDefined();
  });

  it("carries every class of the variant and the size", () => {
    const copied = new Set(copy);
    const missing = [...variant!, ...size!].filter((cls) => !copied.has(cls));
    expect(missing).toEqual([]);
  });

  it("states no hover of its own", () => {
    // A second `hover:bg-*` beside the copied one would let Tailwind's output
    // order, not the source, decide which hover ships.
    const hovers = (classes: string[]) =>
      classes.filter((cls) => cls.startsWith("hover:")).sort();
    expect(hovers(copy!)).toEqual(hovers(variant!));
    expect(hovers(variant!)).toEqual(["hover:bg-card-hover"]);
  });
});

describe("the overlay close controls are text-toned and named (#1208)", () => {
  // The value half is in `elevation-contrast.spec.ts`: `--muted` on
  // `--popover` misses the text gate, `--muted-foreground` clears it. All three
  // draw an X glyph on `--popover` (the toast's default variant included).
  it.each(["dialog.tsx", "sheet.tsx", "toast.tsx"])("%s", (file) => {
    const source = withoutComments(
      readFileSync(join(WEB, "components", "ui", file), "utf8"),
    );
    const close = /<\w+\.Close\b[\s\S]*?<\/\w+\.Close>/.exec(source)?.[0];
    expect(close, `${file} no longer renders a Close control`).toBeDefined();
    const classes = /className=\{cn\(\s*"([^"]+)"/.exec(close!)?.[1] ?? "";
    expect(classes).toMatch(/(?:^|\s)text-muted-foreground(?:\s|$)/);
    expect(classes).not.toMatch(/(?:^|\s)text-muted(?:\s|$)/);
    // The X is aria-hidden, so the control's name is this text.
    expect(close).toMatch(/<span className="sr-only">Close<\/span>/);
  });
});

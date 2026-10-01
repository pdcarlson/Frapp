import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { productSourceFiles, REPO, withoutComments } from "@/tests/source-scan";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
 * outright, in each spelling known to reach them: a colour utility at any
 * variant and opacity (`@apply` included), a `var()` read, the `[--x]` /
 * `(--x)` / `(color:--x)` shorthands, a quoted token name handed to a call
 * (`colorVar("--accent")`), Tailwind's `--color-accent` theme variable, and
 * `theme(colors.accent)`. The fixtures below are that list. The scan covers
 * both Next surfaces' TS and CSS (`tests/source-scan.ts`, shared with
 * `status-tint-call-sites.spec.ts`) and both apps' Tailwind configs, where a
 * key could re-export the alias under a new name. Comments are stripped first,
 * since the docstrings explaining a rule quote the very classes it bans.
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
 * style, CSS, an arbitrary value), the `[--accent]`, `(--accent)` and
 * type-hinted `(color:--accent)` shorthands Tailwind accepts, a quoted name
 * handed to a call (`colorVar("--accent")` in a Tailwind config), and the
 * `--color-accent` variable Tailwind derives from a config key. A declaration
 * is not a read, so `--accent: …` does not match; the aliases are declared only
 * in `packages/theme/src/signet.css`, which no scan here reads.
 */
export const ALIAS_VAR =
  /[([](?:\s*color:)?\s*["'`]?--(?:color-)?(?:accent|secondary)(?:-foreground)?["'`]?\s*[,)\]]/g;

/** Tailwind's `theme()` function, in CSS or an arbitrary value. */
export const ALIAS_THEME =
  /theme\(\s*["']?colors\.(?:accent|secondary)(?![\w-])/g;

const aliasHits = (source: string) => [
  ...(source.match(ALIAS_UTILITY) ?? []),
  ...(source.match(ALIAS_VAR) ?? []),
  ...(source.match(ALIAS_THEME) ?? []),
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
    "bg-(color:--accent)",
    '"row-hover": colorVar("--accent"),',
    "hover:bg-[var(--color-secondary)]",
    "hover:bg-[theme(colors.accent)]",
    "background: theme('colors.secondary.DEFAULT');",
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
    'colorVar("--accent-subtle")',
    "theme(colors.accent-subtle)",
  ])("leaves %s alone", (cls) => {
    expect(aliasHits(cls)).toEqual([]);
  });
});

describe("no Next surface paints the --accent or --secondary alias", () => {
  const files = [
    ...productSourceFiles(/\.(tsx?|css)$/),
    // A config key is a second name for a token: `colorVar("--accent")` under
    // any key would bring the alias back as a class this ban can't spell.
    join(WEB, "tailwind.config.ts"),
    join(REPO, "apps", "landing", "tailwind.config.ts"),
  ];

  it("scans a real corpus, stylesheets and configs included", () => {
    // Each root is walked, and a root that moved would throw (as would a
    // config that moved, on read). This is the other half: the walk found the
    // product, not an empty directory.
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

  it("paints no other background hover anywhere in the drawer", () => {
    // A shared hover written into the row's template prefix would compete
    // with the two above at the same specificity, and Tailwind's output order
    // would decide which ships. So the file holds exactly these two.
    expect(drawer.match(/(?<![\w-])hover:bg-[^\s"'`]+/g)?.sort()).toEqual([
      "hover:bg-accent-subtle-hover",
      "hover:bg-card-hover",
    ]);
  });
});

describe("a tinted row hover stays inside its rounded list", () => {
  /*
   * Settings' officer-tools list is a rounded card of link rows. Its row hover
   * is a visible tint, so the end rows take the list's inner radius rather than
   * painting square corners past the card's curve. The list doesn't clip with
   * `overflow-hidden`, which would clip the rows' focus ring too.
   */
  const settings = withoutComments(
    readFileSync(join(WEB, "components", "settings", "settings-page.tsx"), "utf8"),
  );
  const tools = /function SettingsToolsOnly[\s\S]*?\n}\n/.exec(settings)?.[0] ?? "";

  it("finds the tools list", () => {
    expect(tools).toMatch(/hover:bg-accent-subtle/);
  });

  it("rounds the first and last rows to the list's inner radius", () => {
    expect(tools).toMatch(/rounded-\[14px\] border border-border/);
    expect(tools).toMatch(/<li key=\{tool\.id\} className="group">/);
    expect(tools).toMatch(/group-first:rounded-t-\[13px\]/);
    expect(tools).toMatch(/group-last:rounded-b-\[13px\]/);
  });
});

describe("global-error's hand copy of the Secondary button", () => {
  /*
   * `app/global-error.tsx` replaces the root layout and may not import the
   * component tree, so it restates `Button variant="secondary" size="sm"`. The
   * first fix for #1220 had to land twice for exactly that reason, and a class
   * changed in one and not the other is invisible to every other guard.
   *
   * So the copy is compared, both ways, with the classes that button actually
   * renders: `cn(buttonVariants(...))`, the same merge `Button` applies, so the
   * base's `border-transparent` resolves under the variant's `border-input` as
   * it does on screen. Two kinds of class are left out of the comparison on
   * purpose. The base's icon (`[&_svg]:*`) and disabled (`disabled:*`) classes
   * don't apply, since this button has no icon and is never disabled. And
   * `mt-1` is the copy's placement in its own layout, not part of the recipe.
   */
  const globalError = readFileSync(join(WEB, "app", "global-error.tsx"), "utf8");
  const copy = /className="([^"]*\bborder-input\b[^"]*)"/
    .exec(globalError)?.[1]
    ?.split(/\s+/);
  const rendered = cn(buttonVariants({ variant: "secondary", size: "sm" }))
    .split(/\s+/)
    .filter((cls) => !cls.startsWith("[&_svg]:") && !cls.startsWith("disabled:"));
  const PLACEMENT = new Set(["mt-1"]);

  it("finds the copy", () => {
    expect(copy, "global-error.tsx no longer has the Secondary button").toBeDefined();
  });

  it("renders exactly what Button secondary sm renders", () => {
    const copied = copy!.filter((cls) => !PLACEMENT.has(cls));
    expect(
      [...new Set(copied)].sort(),
      "global-error.tsx's Secondary button has drifted from button.tsx",
    ).toEqual([...new Set(rendered)].sort());
  });

  it("hovers to --card-hover", () => {
    expect(rendered.filter((cls) => cls.startsWith("hover:"))).toEqual([
      "hover:bg-card-hover",
    ]);
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

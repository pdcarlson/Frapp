import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  classLiterals,
  codeWithoutComments,
  productSourceFiles,
  REPO,
} from "@/tests/source-scan";
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
 * **The alias ban.** `--accent` and `--secondary` were ShadCN's names for
 * exactly `--popover`'s and `--card`'s values, and the names hid it.
 * `hover:bg-accent` read like a highlight and was the elevated step itself, so
 * inside a dialog or sheet it painted a control in its container's own colour:
 * the Secondary button (#1220), the notification drawer's rows (#1208), and
 * before them a dialog's role rows, a card's coordinate list and `/polls`'
 * meter track, each found on a screenshot rather than by a guard.
 *
 * The variables, their `-foreground` pairs and the Tailwind `secondary` and
 * `accent` keys are deleted (#3036), and the ban stays anyway. With the keys
 * gone, `hover:bg-accent` compiles to nothing: no wrong colour any more, but
 * the silent no-colour failure #1145 was, where a scaffold paste ships a
 * control with no hover and no build error. The reasons below are why the
 * names are wrong, not a claim that the aliases are live.
 *
 * A rule keyed on the container ("no `bg-accent` on a `--popover`") is what the
 * issue first asked for, and a regex cannot evaluate it. It also isn't needed:
 * the old name is never the honest spelling, because a rest fill can name the
 * ladder step it means (`bg-popover`, `bg-card`) and a hover has state tokens
 * (`bg-card-hover`, `bg-accent-subtle`). So the four retired names are banned
 * outright, in each spelling known to reach them: a colour utility at any
 * variant and opacity (`@apply` included), a `var()` read, the `[--x]` /
 * `(--x)` / `(color:--x)` shorthands, a quoted token name handed to a call
 * (`colorVar("--accent")`), Tailwind's `--color-accent` theme variable, and
 * `theme(colors.accent)`. The fixtures below are that list. The scan covers
 * both Next surfaces' TS and CSS (`tests/source-scan.ts`, shared with
 * `status-tint-call-sites.spec.ts`) and both apps' Tailwind configs, where a
 * key could re-export the alias under a new name. A script file is read as its
 * string and template text only (`classLiterals`), since the docstrings
 * explaining a rule quote the very classes it bans, and a regex comment
 * stripper let a `"image/*"` hide everything up to the next `*\/` (#3088).
 * Reading literals alone loses the call around a quoted name, so a literal
 * that is exactly a retired name is a hit by itself.
 *
 * A ban on a name cannot stop the same defect spelled with an honest name
 * (`hover:bg-popover` on a row in a sheet), so the hovers this change chose are
 * pinned at their call sites below as well.
 */

const WEB = join(REPO, "apps", "web");

/**
 * A colour utility of one of the four retired tokens. The prefix list is every
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
 * is not a read, so `--accent: …` does not match. No stylesheet declares the
 * names any more (#3036), and `packages/theme/src/tailwind.config.spec.ts`
 * owns the config-key half.
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

/**
 * A string literal that is a retired variable's name and nothing else: what
 * `colorVar("--accent")` or `getPropertyValue("--secondary")` hands over, once
 * the call around it is no longer in the text being read. Unlike
 * {@link ALIAS_VAR} it can't tell a read from a declaration, so an inline
 * `style={{ "--accent": … }}` is flagged too. That is the wanted answer: the
 * variables are deleted (#3036), and declaring one would bring the alias back.
 */
export const ALIAS_NAME = /^--(?:color-)?(?:accent|secondary)(?:-foreground)?$/;

/** A `theme()` path handed over as a literal, as {@link ALIAS_NAME} is. */
export const ALIAS_THEME_PATH = /^colors\.(?:accent|secondary)(?![\w-])/;

/** Every alias read in a file: its class text, and its bare quoted names. */
export const aliasHitsIn = (path: string) =>
  classLiterals(path).flatMap((literal) => [
    ...aliasHits(literal),
    ...(ALIAS_NAME.test(literal) || ALIAS_THEME_PATH.test(literal)
      ? [literal]
      : []),
  ]);

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

describe("no Next surface reads the retired --accent or --secondary alias", () => {
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
      aliasHitsIn(file).map((hit) => `${relative(REPO, file)}: ${hit}`),
    );
    expect(
      hits,
      "never the retired alias: a rest fill names its ladder step (`bg-popover`, " +
        "`bg-card`), and a hover takes a state token above what it sits on " +
        "(`bg-card-hover`, or §2's `bg-accent-subtle` for a row in a menu or " +
        "table). Never hover to the surface the control already sits on.",
    ).toEqual([]);
  });
});

describe("the alias scan reads class strings, not comments (#3088)", () => {
  const dir = mkdtempSync(join(tmpdir(), "elevation-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, body: string) => {
    const path = join(dir, name);
    writeFileSync(path, body);
    return path;
  };

  it("sees an alias after a string holding a comment opener", () => {
    const path = write(
      "after-glob.tsx",
      [
        'export const A = <input accept="image/*" />;',
        'export const B = <li className="hover:bg-accent">x</li>;',
        "/** end */",
      ].join("\n"),
    );
    expect(aliasHitsIn(path)).toEqual(["bg-accent"]);
  });

  it("sees an alias after a `//` inside a template", () => {
    const path = write(
      "template.ts",
      'export const A = `${base}//x bg-secondary`;\nexport const B = { background: "var(--accent)" };',
    );
    expect(aliasHitsIn(path).sort()).toEqual(["(--accent)", "bg-secondary"]);
  });

  it("sees a retired name or theme path handed to a call", () => {
    const path = write(
      "config.ts",
      [
        'export default { colors: { "row-hover": colorVar("--accent") } };',
        'export const row = ({ theme }) => theme("colors.secondary.DEFAULT");',
      ].join("\n"),
    );
    expect(aliasHitsIn(path)).toEqual(["--accent", "colors.secondary.DEFAULT"]);
  });

  it("skips prose that names the alias, and the chapter-accent family", () => {
    const path = write(
      "prose.tsx",
      [
        "// hover:bg-accent was the elevated step itself",
        "/* var(--secondary) */",
        'export const A = <li className="hover:bg-accent-subtle">x</li>;',
        'export const B = colorVar("--accent-subtle");',
      ].join("\n"),
    );
    expect(aliasHitsIn(path)).toEqual([]);
  });

  it("strips CSS comments and reads the rest", () => {
    const path = write(
      "sheet.css",
      '.a { content: "x"; /* var(--accent) */ }\n.b { background: var(--secondary); }',
    );
    expect(aliasHitsIn(path)).toEqual(["(--secondary)"]);
  });
});

describe("codeWithoutComments", () => {
  // The pins below read structure, which literals alone can't show, so they
  // strip comments with the parser instead of a regex that can't see strings.
  const dir = mkdtempSync(join(tmpdir(), "elevation-code-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("drops comments and nothing that only looks like one", () => {
    const path = join(dir, "strip.tsx");
    writeFileSync(
      path,
      [
        "// gone",
        'export const A = <input accept="image/*" />;',
        "export const B = `${base}//kept`; /* gone too */",
        "export const C = <p>// kept as JSX text {/* gone */}</p>;",
        'export const D = <li className="hover:bg-card-hover" />;',
      ].join("\n"),
    );
    const code = codeWithoutComments(path);
    expect(code).not.toMatch(/gone/);
    expect(code).toContain('accept="image/*"');
    expect(code).toContain("${base}//kept");
    expect(code).toContain("// kept as JSX text");
    expect(code).toContain('className="hover:bg-card-hover"');
  });

  it("keeps the code after a JSDoc block holding a nested comment", () => {
    // The walk reports a `// …` or `{@link}` inside a JSDoc as a second range
    // within the block's own; cutting both used to eat the code after it.
    const path = join(dir, "jsdoc.ts");
    writeFileSync(
      path,
      [
        "/** Reads {@link X} // not a comment */",
        "export const KEEP = 1;",
        "/**",
        " * @param {number} n // count",
        " */",
        "export function keep(n: number) {}",
      ].join("\n"),
    );
    expect(codeWithoutComments(path)).toBe(
      "\nexport const KEEP = 1;\n\nexport function keep(n: number) {}",
    );
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
  const drawer = codeWithoutComments(
    join(WEB, "components", "layout", "dashboard-notification-drawer.tsx"),
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
  const settings = codeWithoutComments(
    join(WEB, "components", "settings", "settings-rail.tsx"),
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
    const source = codeWithoutComments(join(WEB, "components", "ui", file));
    const close = /<\w+\.Close\b[\s\S]*?<\/\w+\.Close>/.exec(source)?.[0];
    expect(close, `${file} no longer renders a Close control`).toBeDefined();
    const classes = /className=\{cn\(\s*"([^"]+)"/.exec(close!)?.[1] ?? "";
    expect(classes).toMatch(/(?:^|\s)text-muted-foreground(?:\s|$)/);
    expect(classes).not.toMatch(/(?:^|\s)text-muted(?:\s|$)/);
    // The X is aria-hidden, so the control's name is this text.
    expect(close).toMatch(/<span className="sr-only">Close<\/span>/);
  });
});

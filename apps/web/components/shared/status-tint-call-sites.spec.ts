import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classLiterals, productSourceFiles, REPO } from "@/tests/source-scan";

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

/** Roots, walker and literal reading: `tests/source-scan.ts`, shared with
 * `elevation-call-sites.spec.ts` so the two bans cannot scan different trees.
 * Only string and template text is read, so prose naming a banned shape is
 * skipped and a `"image/*"` can't hide what follows it (#3088). */
const sourceFiles = () => productSourceFiles();

/** A semantic status family's background, followed by an opacity modifier. */
export const ALPHA_STATUS_FILL =
  /(?<![\w-])bg-(success|warning|destructive|info)\/[\w.[\]%]+/g;

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

/** A utility without Tailwind v4's `!` important marker, either spelling. */
const unimportant = (utility: string) => utility.replace(/^!|!$/g, "");

/**
 * The unlifted danger text a class list paints on the danger tint. Solid
 * `--destructive` misses the gate on its own tint from `--surface-1` up, so
 * danger text on the tint is `--destructive-text` (foundations §5).
 *
 * Checked per state rather than per class, because a text and a tint under
 * different variants still meet: `data-[state=active]:bg-destructive-tint`
 * with no text of its own shows the list's bare `text-destructive`, and
 * `bg-destructive-tint hover:text-destructive` shows it on hover. Each state
 * is the tint's variants plus one danger text's, and in it the text that wins
 * is an `!important` one if any applies, else the one with the most variants,
 * which is how the cascade resolves Tailwind's variant stacking.
 */
export function unliftedDangerOnTint(classList: string): string[] {
  const parsed = classList
    .split(/\s+/)
    .filter(Boolean)
    .map((cls) => {
      const { variants, utility } = parseClass(cls);
      return {
        cls,
        variants,
        utility: unimportant(utility),
        important: unimportant(utility) !== utility,
      };
    });
  const texts = parsed.filter((c) => DANGER_TEXT.has(c.utility));
  const found = new Set<string>();
  for (const tint of parsed.filter((c) => DANGER_TINT.test(c.utility))) {
    const states = [
      tint.variants,
      ...texts.map((t) => [...tint.variants, ...t.variants]),
    ];
    for (const state of states) {
      const applicable = texts.filter((text) =>
        text.variants.every((v) => state.includes(v)),
      );
      const important = applicable.filter((t) => t.important);
      const pool = important.length > 0 ? important : applicable;
      const depth = Math.max(-1, ...pool.map((t) => t.variants.length));
      for (const text of pool.filter((t) => t.variants.length === depth)) {
        if (text.utility === "text-destructive") {
          found.add(`${tint.cls} under ${text.cls}`);
        }
      }
    }
  }
  return [...found];
}

/** Every alpha status fill in a file's class text. */
export const alphaStatusFillsIn = (path: string) =>
  classLiterals(path).flatMap(
    (literal) => literal.match(ALPHA_STATUS_FILL) ?? [],
  );

/** Every unlifted danger label on the danger tint, one class list at a time. */
export const unliftedDangerIn = (path: string) =>
  classLiterals(path).flatMap(unliftedDangerOnTint);

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
      alphaStatusFillsIn(file).map(
        (match) => `${relative(REPO, file)}: ${match}`,
      ),
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
      // A text under more variants than the tint meets it in that state.
      "bg-destructive-tint text-destructive-text hover:text-destructive",
      // Either spelling of Tailwind v4's important marker.
      "bg-destructive-tint !text-destructive",
      "bg-destructive-tint text-destructive-text text-destructive!",
    ];
    for (const classList of flagged) {
      expect(unliftedDangerOnTint(classList), classList).toHaveLength(1);
    }
    // And leaves the shipped shapes alone.
    const clean = [
      "bg-destructive-tint text-destructive-text hover:bg-destructive-tint-hover",
      "text-destructive data-[state=active]:bg-destructive-tint data-[state=active]:text-destructive-text",
      "enabled:group-[.destructive]:text-destructive-text enabled:group-[.destructive]:hover:bg-popover enabled:group-[.destructive]:hover:bg-[linear-gradient(var(--destructive-tint-hover),var(--destructive-tint-hover))]",
      // Unlifted danger text in a state the tint is not in.
      "text-destructive hover:bg-destructive-tint hover:text-destructive-text",
      // Text from a child element is out of this scan's reach, not a failure.
      "border-destructive/45 bg-destructive-tint p-3",
    ];
    for (const classList of clean) {
      expect(unliftedDangerOnTint(classList), classList).toEqual([]);
    }
  });

  it("finds no danger label on the danger tint in the unlifted hue", () => {
    const offenders = files.flatMap((file) =>
      unliftedDangerIn(file).map((hit) => `${relative(REPO, file)}: ${hit}`),
    );
    expect(
      offenders,
      "danger text on the danger tint is text-destructive-text (foundations §5)",
    ).toEqual([]);
  });
  describe("reads class strings, not comments (#3088)", () => {
    const dir = mkdtempSync(join(tmpdir(), "status-tint-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const write = (body: string) => {
      const path = join(
        dir,
        `fixture-${Math.random().toString(36).slice(2)}.tsx`,
      );
      writeFileSync(path, body);
      return path;
    };

    it("sees a banned class after a string holding a comment opener", () => {
      // A regex stripper read `"image/*"` as a comment running to the next
      // `*\/`, and the class between them vanished.
      const path = write(
        [
          'export const A = <input accept="image/*" />;',
          'export const B = <p className="bg-success/15">x</p>;',
          'export const C = "bg-destructive-tint text-destructive";',
          "/** end */",
        ].join("\n"),
      );
      expect(alphaStatusFillsIn(path)).toEqual(["bg-success/15"]);
      expect(unliftedDangerIn(path)).toHaveLength(1);
    });

    it("sees a class after a `//` inside a template", () => {
      const path = write(
        "export const A = `${base}//x bg-warning/20 ${tint}`;\n" +
          "export const B = `bg-destructive-tint ${extra} text-destructive`;",
      );
      expect(alphaStatusFillsIn(path)).toEqual(["bg-warning/20"]);
      // A template's interpolation doesn't split one class list in two.
      expect(unliftedDangerIn(path)).toHaveLength(1);
    });

    it("skips prose that names the banned shape", () => {
      const path = write(
        [
          "// never bg-success/15 here",
          "/* bg-destructive-tint text-destructive */",
          'export const A = "bg-success-tint";',
        ].join("\n"),
      );
      expect(alphaStatusFillsIn(path)).toEqual([]);
      expect(unliftedDangerIn(path)).toEqual([]);
    });
  });
});

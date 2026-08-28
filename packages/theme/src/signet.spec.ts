import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseHex } from "@repo/color";
import { describe, expect, it } from "vitest";

import { getSignetCssVars, signetDarkTokens } from "./signet";

/**
 * Spec-conformance for the Signet token set.
 *
 * `tsc` only proves these fields are `string` and `number`. What actually
 * matters is that each one still carries the value
 * `spec/ui/design-system/foundations.md` pins — that file is canonical
 * (foundations §1), and `signet.ts` says in its own header that its values are
 * transcribed from it.
 *
 * So this suite reads the spec and compares, rather than restating the numbers
 * a second time. Restating them would only prove `signet.ts` matches this file;
 * parsing the spec proves it matches the document the designers edit, and fails
 * whichever side drifts. When a value legitimately changes, the spec table is
 * the thing to edit — the code and this suite both follow it.
 */

const FOUNDATIONS = fileURLToPath(
  new URL("../../../spec/ui/design-system/foundations.md", import.meta.url),
);

const spec = (() => {
  try {
    return readFileSync(FOUNDATIONS, "utf8");
  } catch (cause) {
    throw new Error(
      `Could not read the canonical token spec at ${FOUNDATIONS}. ` +
        "If it moved, update this path — do not delete the assertions, or the " +
        "Signet token values go back to being covered by nothing.",
      { cause },
    );
  }
})();

// ── Markdown helpers ─────────────────────────────────────────────────────────

/**
 * Body text of a `## <n>. ...` section, up to the next `## ` heading.
 *
 * Split rather than matched with an end-anchored lookahead: JavaScript has no
 * `\Z`, so the obvious `(?=^## |\Z)` silently degrades to "next heading, or the
 * first literal capital Z" — which happens to work on today's document and
 * would truncate a section the moment someone wrote "Zones" above a table.
 */
function section(n: number): string {
  const body = spec
    .split(/^## /m)
    .slice(1)
    .find((chunk) => chunk.startsWith(`${n}.`));
  if (!body) throw new Error(`foundations.md has no section ${n}`);
  return body;
}

/** Table rows of a section as trimmed, backtick-stripped cells (header dropped). */
function rows(n: number): string[][] {
  const parsed = section(n)
    .split("\n")
    .filter((line) => line.trimStart().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim().replace(/`/g, "")),
    )
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));

  return parsed.slice(1); // drop the header row
}

/** `--token` → value, for the two-column-plus token tables (§2–§5). */
function tokenTable(n: number): Map<string, string> {
  return new Map(rows(n).map((cells) => [cells[0] ?? "", cells[1] ?? ""]));
}

/**
 * Look up a pinned value, failing with the row that went missing.
 *
 * Worth the four lines: a bare `map.get(key)!` hands `undefined` to the
 * comparison below, which dies with `Cannot read properties of undefined
 * (reading 'toLowerCase')` naming neither the token nor the section. The row
 * most likely to be edited is §5's `Mention/DM red`, which is prose rather than
 * a token name — so this is the realistic failure, not a hypothetical one.
 */
function pin(table: Map<string, string>, key: string, section: number): string {
  const value = table.get(key);
  if (value === undefined) {
    throw new Error(
      `foundations.md §${section} no longer has a row for "${key}" ` +
        `(rows present: ${[...table.keys()].join(", ")}). If it was renamed, ` +
        "update this suite; if it was deleted, the token it pinned is now " +
        "covered by nothing.",
    );
  }
  return value;
}

/**
 * Colors compare on meaning, not on typing. The spec writes `#3fb950` and
 * `rgba(255,255,255,.08)`; `signet.ts` normalises hex to uppercase (its header
 * says so) and writes a leading zero. Neither difference is a drift.
 */
function sameColor(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/\s+/g, "").replace(/([(,])\./g, "$10.");
  return norm(a) === norm(b);
}

/** Every number in a cell, in order — `16 / 25` → `[16, 25]`, `8–10` → `[8, 10]`. */
function numbers(cell: string): number[] {
  return (cell.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Every `--token` foundations.md names in its §2–§5 tables. */
function documentedTokens(): string[] {
  return [2, 3, 4, 5]
    .flatMap((n) => [...tokenTable(n).keys()])
    .filter((name) => name.startsWith("--"));
}

function expectColor(actual: string, specValue: string, label: string): void {
  expect(
    sameColor(actual, specValue),
    `${label}: code has ${actual}, foundations.md pins ${specValue}`,
  ).toBe(true);
}

// ── §2–§5: the fixed color tokens ────────────────────────────────────────────

describe("Signet colors match foundations.md", () => {
  const { color } = signetDarkTokens;

  it("§2 surface ladder", () => {
    const t = tokenTable(2);
    expectColor(color.surface.background, pin(t, "--background", 2), "--background");
    expectColor(color.surface.surface1, pin(t, "--surface-1", 2), "--surface-1");
    expectColor(color.surface.card, pin(t, "--card", 2), "--card");
    expectColor(color.surface.popover, pin(t, "--popover", 2), "--popover");
  });

  it("§3 hairlines are low-opacity white, not fixed hex", () => {
    const t = tokenTable(3);
    expectColor(color.border.hairline, pin(t, "--border", 3), "--border");
    expectColor(color.border.input, pin(t, "--input", 3), "--input");

    // The spec does not merely pin these two values, it bans the alternative:
    // "Borders MUST be low-opacity white. Fixed-hex border colors are banned."
    for (const [name, value] of Object.entries(color.border)) {
      expect(value, `border.${name} must be an rgba() hairline`).toMatch(
        /^rgba\(255,\s*255,\s*255,\s*0?\.\d+\)$/,
      );
    }
  });

  it("§4 text ladder", () => {
    const t = tokenTable(4);
    expectColor(color.text.foreground, pin(t, "--foreground", 4), "--foreground");
    expectColor(
      color.text.mutedForeground,
      pin(t, "--muted-foreground", 4),
      "--muted-foreground",
    );
    expectColor(color.text.muted, pin(t, "--muted", 4), "--muted");
    expectColor(color.text.disabled, pin(t, "--disabled", 4), "--disabled");
  });

  it("§5 semantic colors, including the fixed mention red", () => {
    const t = tokenTable(5);
    expectColor(color.semantic.success, pin(t, "--success", 5), "--success");
    expectColor(color.semantic.warning, pin(t, "--warning", 5), "--warning");
    expectColor(
      color.semantic.destructive,
      pin(t, "--destructive", 5),
      "--destructive",
    );
    expectColor(color.semantic.info, pin(t, "--info", 5), "--info");

    // Locked by the Canvas header rather than panel 4h, and load-bearing: it
    // states "you were addressed" identically in every chapter, so it must not
    // track the tenant accent.
    expectColor(
      color.semantic.mention,
      pin(t, "Mention/DM red", 5),
      "mention/DM red",
    );
    expect(color.semantic.mentionForeground.toLowerCase()).toBe("#ffffff");
  });

  it("every color token is a parseable color", () => {
    const walk = (node: unknown, path: string): void => {
      if (typeof node === "string") {
        const ok =
          parseHex(node) !== null ||
          /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*0?\.?\d+\s*)?\)$/.test(
            node,
          );
        expect(ok, `${path} is not a parseable color: ${node}`).toBe(true);
        return;
      }
      for (const [key, value] of Object.entries(node as object)) {
        walk(value, `${path}.${key}`);
      }
    };
    walk(signetDarkTokens.color, "color");
  });
});

// ── §7–§10: the non-color scales ─────────────────────────────────────────────

describe("Signet scales match foundations.md", () => {
  it("§7 type scale, with body pinned at 16/25", () => {
    const { role } = signetDarkTokens.typography;
    const specRoles = new Map(
      rows(7).map((cells) => [
        (cells[0] ?? "").toLowerCase(),
        { size: numbers(cells[1] ?? ""), weight: numbers(cells[2] ?? "")[0] },
      ]),
    );

    for (const [name, actual] of Object.entries(role)) {
      const pinned = specRoles.get(name);
      expect(pinned, `foundations.md §7 has no row for "${name}"`).toBeDefined();
      expect(actual.size, `${name} size`).toBe(pinned!.size[0]);
      expect(actual.weight, `${name} weight`).toBe(pinned!.weight);
      // Only `body` carries a line height in the spec; signet.ts documents that
      // the rest are deliberately left to the platform.
      expect(actual.lineHeight, `${name} line height`).toBe(pinned!.size[1]);
    }

    // "Body text MUST NOT render below 16" — the one size the spec states as a
    // floor rather than only as a table cell.
    expect(role.body.size).toBeGreaterThanOrEqual(16);
    expect(signetDarkTokens.typography.family.sans).toBe("Figtree");
  });

  it("§8 radius map", () => {
    const { radius } = signetDarkTokens;
    const table = rows(8);
    const byRow = (needle: string): number[] => {
      const row = table.find((cells) =>
        (cells[0] ?? "").toLowerCase().includes(needle),
      );
      if (!row) throw new Error(`foundations.md §8 has no "${needle}" row`);
      return numbers(row[1] ?? "");
    };

    expect([radius.control]).toEqual(byRow("controls"));
    expect([radius.card, radius.cardLarge]).toEqual(byRow("cards"));
    expect([radius.bubble, radius.bubbleTail]).toEqual(byRow("chat bubbles"));
    expect([radius.sheet]).toEqual(byRow("sheets"));
    expect([radius.chip, radius.chipLarge]).toEqual(byRow("badges"));
    expect([radius.navItem]).toEqual(byRow("sidebar"));
    expect(radius.avatar).toBe("50%");
  });

  it("§9 spacing grid and touch minimums", () => {
    const body = section(9);

    const steps = numbers(body.match(/Steps:\s*([\d\s/]+)/)?.[1] ?? "");
    expect(Object.values(signetDarkTokens.spacing)).toEqual(steps);

    // "Touch targets MUST be ≥ 44px. Buttons run 46–48px tall. Tab bar items
    // are 56px tall."
    const [minimum] = numbers(body.match(/≥\s*(\d+)px/)?.[0] ?? "");
    const buttons = numbers(body.match(/Buttons run ([\d–-]+)px/)?.[1] ?? "");
    const [tabBar] = numbers(body.match(/Tab bar items are (\d+)px/)?.[1] ?? "");

    const { touch } = signetDarkTokens;
    expect(touch.minimum).toBe(minimum);
    expect([touch.button, touch.buttonLarge]).toEqual(buttons);
    expect(touch.tabBar).toBe(tabBar);

    // The floor is a rule, not just a number: nothing tappable may sit under it.
    for (const [name, value] of Object.entries(touch)) {
      expect(value, `touch.${name} is below the 44px floor`).toBeGreaterThanOrEqual(
        touch.minimum,
      );
    }
  });

  it("§10 focus ring", () => {
    const body = section(10);
    const [width] = numbers(body.match(/(\d+)px spread/)?.[1] ?? "");
    const [percent] = numbers(body.match(/~?(\d+)% opacity/)?.[1] ?? "");

    expect(signetDarkTokens.focus.ringWidth).toBe(width);
    expect(signetDarkTokens.focus.ringOpacity).toBeCloseTo(percent! / 100, 5);
  });
});

// ── getSignetCssVars ─────────────────────────────────────────────────────────

describe("getSignetCssVars", () => {
  const vars = getSignetCssVars();

  /**
   * The tokens `getSignetCssVars()` emits that foundations.md's tables do NOT
   * name as `--tokens`, so they cannot be derived from the spec parsed here.
   * The gold family is owned by `brand-identity.md`; the mention pair appears in
   * §5 as the prose row "Mention/DM red" rather than under a token name.
   */
  const UNDOCUMENTED_HERE = [
    "--gold-ask-border",
    "--gold-ask-fill",
    "--gold-ask-text",
    "--gold-house",
    "--gold-on-house",
    "--mention",
    "--mention-foreground",
  ];

  it("emits exactly the documented key set", () => {
    // Names, not values — the values are covered above. Composed from the spec
    // rather than restated, so adding a token to a foundations table and to
    // `signet.ts` — the two-edit workflow this file's header prescribes — does
    // not also require editing a literal here, and a failure names the token
    // instead of diffing two anonymous arrays.
    const expected = [...documentedTokens(), ...UNDOCUMENTED_HERE];

    expect(Object.keys(vars).sort()).toEqual(expected.sort());
  });

  it("emits every fixed token foundations.md names", () => {
    const documented = documentedTokens();

    expect(documented.length).toBeGreaterThan(0);
    for (const name of documented) {
      expect(vars, `foundations.md documents ${name} but it is not emitted`)
        .toHaveProperty(name);
    }
  });

  it("omits the per-tenant accent family", () => {
    // §6: the accent slot is resolved per chapter from a seed by the accent
    // engine, so it cannot be a constant here. If one of these ever appears in
    // this map, a chapter's branding has been hard-coded to house gold.
    // `[a-z0-9-]+`, not `[a-z-]+`: §6 defers scale-step mapping to
    // accent-engine.md, so the day this list gains `--primary-500` a
    // digit-blind pattern would drop it and quietly stop checking the very
    // token most likely to be hard-coded to house gold.
    const listed = section(6).match(/`--[a-z0-9-]+`/g);
    expect(
      listed,
      "foundations.md §6 no longer names the accent-slot tokens in backticks — " +
        "this test cannot check what it cannot find",
    ).not.toBeNull();
    const accentSlot = listed!.map((name) => name.replace(/`/g, ""));

    expect(accentSlot).toContain("--primary");
    expect(accentSlot).toContain("--ring");
    for (const name of accentSlot) {
      expect(vars, `${name} is per-tenant and must not be a fixed token`)
        .not.toHaveProperty(name);
    }
  });

  it("carries the same values as the token object", () => {
    const { color } = signetDarkTokens;
    expect(vars["--background"]).toBe(color.surface.background);
    expect(vars["--border"]).toBe(color.border.hairline);
    expect(vars["--foreground"]).toBe(color.text.foreground);
    expect(vars["--gold-house"]).toBe(color.gold.house);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { signetDarkTokens } from "@repo/theme/signet";
import { describe, expect, it } from "vitest";

/**
 * #2842: `apps/web` writes no font size as an arbitrary px literal. Text takes
 * a foundations §7 role key (`text-caption`, `text-label`, …).
 *
 * The keys exist so a screen never has to write `text-[12.5px]`. Web wrote it
 * 174 times beside one `text-caption`, so a change to the caption role would
 * have reached one site and missed the rest: the parallel-token shape the
 * cutover rule bans. Sizes the board draws off the scale (11, 13, 13.5, 15) are
 * not an exception either. `components.md`'s opening rule rounds a drawn size
 * onto the adjacent §7 step and transcribes only the weight and the relation
 * between sizes, and §7 calls an off-scale size in screen code a defect.
 *
 * What remains is listed in {@link EXCEPTIONS} with its count, so the list is a
 * ratchet: a new literal fails, a new copy of a listed one fails, and an entry
 * whose sites have gone fails until it is deleted.
 */

const WEB = join(__dirname, "..", "..");
/** Where product code lives; `tests/` is harness code. */
const ROOTS = ["app", "components", "hooks", "lib"];
const SOURCE = /\.tsx?$/;
const SPEC = /\.(spec|test)\.tsx?$/;

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
    } else if (entry.isFile() && SOURCE.test(entry.name) && !SPEC.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/** Comments dropped first: prose may quote a literal to explain it. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * An arbitrary font size in px, after any variant prefix (`hover:`,
 * `[&_[cmdk-group-heading]]:`), with or without the `length:` hint or v4's
 * `!` marker, which are stripped so each spelling counts as one literal.
 */
const ARBITRARY_SIZE = /(?<![\w-])!?text-\[(?:length:)?(\d+(?:\.\d+)?)px\]!?/g;

const normalise = (literal: string) =>
  literal.replace(/!/g, "").replace("[length:", "[");

/** Each §7 role by its px size, read from the token source the preset binds. */
const ROLE_BY_SIZE = new Map(
  Object.entries(signetDarkTokens.typography.role).map(([role, { size }]) => [
    String(size),
    role,
  ]),
);

const DRAWN_MARK =
  "Avatar initials are a drawn mark sized to their circle, not a run of " +
  "text (`profile-panel.tsx` gives the reason; `components.md` § App bar " +
  "chips quotes the 30px avatar's 11px initials).";

/**
 * Every arbitrary size `apps/web` still writes, with how many times and why.
 * A glyph sized to a fixed box is not text on the scale. #3075 owns the two
 * board-drawn sizes that are grandfathered rather than reasoned.
 */
const EXCEPTIONS: { file: string; literal: string; count: number; reason: string }[] = [
  {
    file: "components/chat/chip.ts",
    literal: "text-[14px]",
    count: 1,
    reason:
      "ACTION_BAR_BUTTON sizes the quick-reaction emoji inside a 28px icon " +
      "button. It is not label text, and `text-label` would set 600/1.3 on it.",
  },
  { file: "components/chat/mention-list.tsx", literal: "text-[10px]", count: 1, reason: DRAWN_MARK },
  { file: "components/layout/account-menu.tsx", literal: "text-[11px]", count: 1, reason: DRAWN_MARK },
  { file: "components/roles/roles-matrix.tsx", literal: "text-[10px]", count: 1, reason: DRAWN_MARK },
  { file: "components/alumni/alumni-directory.tsx", literal: "text-[9px]", count: 1, reason: DRAWN_MARK },
  { file: "components/members/members-directory.tsx", literal: "text-[9px]", count: 1, reason: DRAWN_MARK },
  { file: "components/profile/profile-panel.tsx", literal: "text-[26px]", count: 1, reason: DRAWN_MARK },
  {
    file: "components/layout/crest-tile.tsx",
    literal: "text-[9.5px]",
    count: 1,
    reason: "The chapter monogram, fitted to its 28px tile.",
  },
  {
    file: "components/layout/crest-tile.tsx",
    literal: "text-[7.5px]",
    count: 1,
    reason: "The monogram's step-down past four characters, which overflow the tile at 9.5.",
  },
  {
    file: "components/layout/top-bar.tsx",
    literal: "text-[9.5px]",
    count: 1,
    reason: "The unread count, fitted inside its 14px dot.",
  },
  {
    file: "components/events/events-calendar.tsx",
    literal: "text-[11px]",
    count: 2,
    reason:
      "Grandfathered: the month grid's event chips and overflow link. At " +
      "caption size four of seven demo titles truncate in a 160px day cell " +
      "that fits them at the board's 11px. #3075 decides.",
  },
  {
    file: "components/billing/pro-chip.tsx",
    literal: "text-[10.5px]",
    count: 1,
    reason: "Grandfathered: board 4b's chip geometry, held by its docstring. #3075 decides.",
  },
  {
    file: "components/billing/plan-panel.tsx",
    literal: "text-[22px]",
    count: 1,
    reason: "Grandfathered: board 4d's plan name. #3075 decides.",
  },
];

/** `file → literal → count` over every product source file. */
function literalsByFile(): Map<string, Map<string, number>> {
  const found = new Map<string, Map<string, number>>();
  for (const root of ROOTS) {
    for (const path of walk(join(WEB, root))) {
      for (const match of code(path).matchAll(ARBITRARY_SIZE)) {
        const file = relative(WEB, path);
        const literal = normalise(match[0]);
        const counts = found.get(file) ?? new Map<string, number>();
        counts.set(literal, (counts.get(literal) ?? 0) + 1);
        found.set(file, counts);
      }
    }
  }
  return found;
}

function hint(literal: string): string {
  const size = literal.match(/\[([\d.]+)px\]/)?.[1] ?? "";
  const role = ROLE_BY_SIZE.get(size);
  return role
    ? `${size}px is the ${role} role; write text-${role}`
    : `${size}px is off the §7 scale; round it onto the adjacent role`;
}

describe("type scale call sites (#2842)", () => {
  it("reads all six roles from the token source", () => {
    expect([...ROLE_BY_SIZE.values()].sort()).toEqual([
      "body",
      "caption",
      "display",
      "headline",
      "label",
      "title",
    ]);
  });

  it("matches a px size in every spelling a class list can carry it", () => {
    const literals = (text: string) =>
      [...text.matchAll(ARBITRARY_SIZE)].map((m) => normalise(m[0]));
    expect(literals("px-2 text-[12.5px] font-semibold")).toEqual(["text-[12.5px]"]);
    expect(literals("hover:text-[11px] !text-[15px] text-[18px]!")).toEqual([
      "text-[11px]",
      "text-[15px]",
      "text-[18px]",
    ]);
    expect(literals("[&_[cmdk-group-heading]]:text-[13px]")).toEqual(["text-[13px]"]);
    expect(literals("text-[length:24px]")).toEqual(["text-[24px]"]);
    expect(literals("text-caption text-muted-foreground h-[13px]")).toEqual([]);
  });

  it("writes no font size as an arbitrary literal outside the ledger", () => {
    const allowed = new Map(EXCEPTIONS.map((e) => [`${e.file} ${e.literal}`, e.count]));
    const found: string[] = [];
    for (const [file, counts] of literalsByFile()) {
      for (const [literal, count] of counts) {
        const limit = allowed.get(`${file} ${literal}`) ?? 0;
        if (count > limit) {
          found.push(`${file}: ${literal} ×${count - limit}: ${hint(literal)}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("keeps every ledger entry exact", () => {
    const found = literalsByFile();
    for (const { file, literal, count } of EXCEPTIONS) {
      expect(
        found.get(file)?.get(literal) ?? 0,
        `${file} writes ${literal} a different number of times; update or drop its entry`,
      ).toBe(count);
    }
  });
});

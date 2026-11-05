import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every presented sheet draws the scrim (`spec/ui/mobile/patterns.md`
 * § Bottom sheets): `backdropComponent={SheetScrim}`, from
 * `components/sheet-scaffold.tsx`.
 *
 * Half the app's sheets once shipped without one, so the screen behind them
 * read through at full brightness and a tap outside them did nothing. A
 * `BottomSheetModal` renders fine with no backdrop, so nothing else notices a
 * new sheet that leaves it out. A static read, like `keyboard-screens.spec.ts`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".spec.tsx")
      ? [path]
      : [];
  });
}

/**
 * Each `<BottomSheetModal …>` opening tag in `source`, with its offset.
 *
 * The tag ends at the first `>` outside any JSX expression: braces are
 * counted, so an arrow function in a prop (`onChange={(i) => …}`) doesn't end
 * it early, and a one-line tag doesn't run on into later JSX and borrow
 * another sheet's `backdropComponent`. The whitespace after the name skips
 * `BottomSheetModalProvider` and type arguments (`useRef<BottomSheetModal>`,
 * `forwardRef<BottomSheetModal, …>`).
 */
function openingTags(source: string): { index: number; tag: string }[] {
  const tags: { index: number; tag: string }[] = [];
  for (const match of source.matchAll(/<BottomSheetModal\s/g)) {
    let depth = 0;
    let end = -1;
    for (let at = match.index + match[0].length; at < source.length; at++) {
      const char = source[at];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) {
        end = at;
        break;
      }
    }
    if (end === -1) continue;
    tags.push({ index: match.index, tag: source.slice(match.index, end + 1) });
  }
  return tags;
}

/** Each `<BottomSheetModal …>` opening tag in the app, by file and line. */
function sheetTags(): { at: string; tag: string }[] {
  return ["app", "components"].flatMap((dir) =>
    sources(join(ROOT, dir)).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return openingTags(source).map(({ index, tag }) => ({
        at: `${relative(ROOT, file)}:${source.slice(0, index).split("\n").length}`,
        tag,
      }));
    }),
  );
}

const SCRIM = /\bbackdropComponent=\{/;

describe("openingTags", () => {
  it("ends a one-line tag at its own `>`, not a later sheet's", () => {
    const source = [
      "<BottomSheetModal ref={a} snapPoints={POINTS}>",
      "  <Body />",
      "</BottomSheetModal>",
      "<BottomSheetModal",
      "  ref={b}",
      "  backdropComponent={SheetScrim}",
      ">",
    ].join("\n");
    const [first, second] = openingTags(source);
    expect(first?.tag).toBe("<BottomSheetModal ref={a} snapPoints={POINTS}>");
    expect(first?.tag).not.toMatch(SCRIM);
    expect(second?.tag).toMatch(SCRIM);
  });

  it("reads past a `>` inside a prop's expression", () => {
    const source =
      "<BottomSheetModal onChange={(i) => i > 0} backdropComponent={SheetScrim}>";
    expect(openingTags(source)[0]?.tag).toBe(source);
  });
});

describe("every bottom sheet draws the scrim", () => {
  const tags = sheetTags();

  it("finds the app's sheets", () => {
    // A guard that matches nothing passes vacuously; there are at least the
    // dozen sheets this spec was written against.
    expect(tags.length).toBeGreaterThanOrEqual(12);
  });

  it.each(tags.map(({ at, tag }) => [at, tag]))(
    "%s passes a backdropComponent",
    (_at, tag) => {
      expect(tag).toMatch(SCRIM);
    },
  );
});

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

/** Each `<BottomSheetModal …>` opening tag, by file and line. */
function sheetTags(): { at: string; tag: string }[] {
  return ["app", "components"].flatMap((dir) =>
    sources(join(ROOT, dir)).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      // The whitespace skips `BottomSheetModalProvider` and type arguments
      // (`useRef<BottomSheetModal>`, `forwardRef<BottomSheetModal, …>`).
      // The tag ends at the first `>` that opens a line, which is how every
      // multi-line opening tag here is formatted.
      return [...source.matchAll(/<BottomSheetModal\s[\s\S]*?\n\s*>/g)].map(
        (match) => ({
          at: `${relative(ROOT, file)}:${
            source.slice(0, match.index).split("\n").length
          }`,
          tag: match[0],
        }),
      );
    }),
  );
}

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
      expect(tag).toMatch(/\bbackdropComponent=\{/);
    },
  );
});

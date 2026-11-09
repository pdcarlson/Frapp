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
 *
 * The same read holds the other half of a sheet's way out: its first child is
 * `<SheetBackToClose …/>`, so Android's back button closes the sheet rather
 * than the screen under it. gorhom handles no back press, and a picker or menu
 * with no Cancel (components.md § Chrome weight) would otherwise have no
 * button-press way out at all. And the same close is VoiceOver's escape:
 * `onAccessibilityEscape={close}` inside the sheet, or on a body component the
 * sheet hands `close` to, since gorhom wires that gesture to nothing either.
 *
 * And every sheet declares how it stacks (`SHEET_STACK_BEHAVIOR`, or
 * `"replace"`), so a sheet opened from a sheet closes back to it (#3790).
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
 * `forwardRef<BottomSheetModal, …>`), and a prop name, spread or `>` must
 * follow, which skips a union (`RefObject<BottomSheetModal | null>`).
 */
function openingTags(source: string): { index: number; tag: string }[] {
  const tags: { index: number; tag: string }[] = [];
  for (const match of source.matchAll(/<BottomSheetModal\s+(?=[A-Za-z{>/])/g)) {
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

/**
 * Each `<BottomSheetModal …>` opening tag in the app, by file and line, with
 * the source that follows it.
 */
function sheetTags(): {
  at: string;
  tag: string;
  after: string;
  source: string;
}[] {
  return ["app", "components"].flatMap((dir) =>
    sources(join(ROOT, dir)).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return openingTags(source).map(({ index, tag }) => ({
        at: `${relative(ROOT, file)}:${source.slice(0, index).split("\n").length}`,
        tag,
        after: source.slice(index + tag.length),
        source,
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

  it("skips a type union that names the modal", () => {
    const source =
      "type Ref = RefObject<BottomSheetModal | null>;\n<BottomSheetModal ref={a}>";
    expect(openingTags(source).map(({ tag }) => tag)).toEqual([
      "<BottomSheetModal ref={a}>",
    ]);
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

describe("every bottom sheet closes on Android back", () => {
  const tags = sheetTags();

  it.each(tags.map(({ at, after }) => [at, after]))(
    "%s renders SheetBackToClose first",
    (_at, after) => {
      expect(after.trimStart()).toMatch(/^<SheetBackToClose\s/);
    },
  );
});

/**
 * A stack behavior the app may use: the shared `SHEET_STACK_BEHAVIOR` (`push`),
 * or `"replace"`, for a sheet that takes an action menu's place on purpose
 * (the message menu's emoji picker and report form). gorhom's default `switch`,
 * or `"switch"` spelled out, dismisses the sheet underneath instead of lowering
 * it in 5.2.14, so closing a sheet opened from a sheet dropped the member on
 * the page (#3790; why: `SHEET_STACK_BEHAVIOR` in
 * `components/sheet-scaffold.tsx`).
 */
const STACKS = /\bstackBehavior=\{SHEET_STACK_BEHAVIOR\}/;
const REPLACES = /\bstackBehavior="replace"/;

/**
 * The sheets that may replace the one under them, by file and count. Only
 * the message menu's emoji picker and report form: `"replace"` dismisses the
 * sheet underneath, so on any other sheet it brings #3790 back. A new entry
 * here is a product call that closing that sheet should show the screen.
 */
const REPLACING: Record<string, number> = {
  "components/chat/emoji-picker-sheet.tsx": 1,
  "components/chat/message-actions-sheet.tsx": 1,
};

describe("no bottom sheet stacks on gorhom's default switch", () => {
  const tags = sheetTags();

  it.each(tags.map(({ at, tag }) => [at, tag]))(
    "%s passes SHEET_STACK_BEHAVIOR or replace",
    (_at, tag) => {
      expect(STACKS.test(tag) || REPLACES.test(tag)).toBe(true);
    },
  );

  it("replaces only where an action menu is consumed", () => {
    const counts: Record<string, number> = {};
    for (const { at, tag } of tags) {
      if (!REPLACES.test(tag)) continue;
      const file = at.slice(0, at.lastIndexOf(":"));
      counts[file] = (counts[file] ?? 0) + 1;
    }
    expect(counts).toEqual(REPLACING);
  });

  it("fails a sheet that leaves stackBehavior out, or spells out switch", () => {
    expect(
      "<BottomSheetModal ref={a} backdropComponent={SheetScrim}>",
    ).not.toMatch(STACKS);
    const spelled = '<BottomSheetModal ref={a} stackBehavior="switch">';
    expect(STACKS.test(spelled) || REPLACES.test(spelled)).toBe(false);
  });

  it("holds the shared behavior at push", async () => {
    const { SHEET_STACK_BEHAVIOR } =
      await import("@/components/sheet-scaffold");
    expect(SHEET_STACK_BEHAVIOR).toBe("push");
  });
});

/**
 * Whether the sheet whose content is `after` wires VoiceOver's escape to the
 * same close its `SheetBackToClose` uses: on a view inside it, or on the body
 * component it passes that close to (the accent sheet's `onDone`).
 */
function escapesTo(after: string, source: string): boolean {
  const close = /^<SheetBackToClose\s+onClose=\{([\w.]+)\}/.exec(
    after.trimStart(),
  )?.[1];
  if (!close) return false;
  const end = after.indexOf("</BottomSheetModal>");
  const body = end === -1 ? after : after.slice(0, end);
  const escape = (name: string) => `onAccessibilityEscape={${name}}`;
  if (body.includes(escape(close))) return true;
  const passed = [...body.matchAll(/(\w+)=\{([\w.]+)\}/g)]
    .filter(([, prop, value]) => value === close && prop !== "onClose")
    .map(([, prop]) => prop!);
  return passed.some((prop) => source.includes(escape(prop)));
}

describe("every bottom sheet closes on VoiceOver's escape", () => {
  const tags = sheetTags();

  it.each(tags.map(({ at, after, source }) => [at, after, source]))(
    "%s passes its close as onAccessibilityEscape",
    (_at, after, source) => {
      expect(escapesTo(after, source)).toBe(true);
    },
  );

  it("fails a sheet that wires back but not escape", () => {
    const after =
      "\n  <SheetBackToClose onClose={closeSheet} />\n  <BottomSheetView>\n  </BottomSheetView>\n</BottomSheetModal>";
    expect(escapesTo(after, after)).toBe(false);
  });

  it("follows a close handed to a body component", () => {
    const after =
      "\n  <SheetBackToClose onClose={closeSheet} />\n  <Body onDone={closeSheet} />\n</BottomSheetModal>";
    const source = `${after}\nfunction Body({ onDone }) { return <View onAccessibilityEscape={onDone} />; }`;
    expect(escapesTo(after, source)).toBe(true);
  });
});

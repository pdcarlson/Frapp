import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every pushed screen has a visible way back (rulebook § 8, Paul 2026-11-20:
 * "no way for me to x out or to go back"). Swipe back is a shortcut; the back
 * row or a close glyph is what people see. This walks every route in
 * `app/(app)` outside the tabs and fails a new one until the route file, or a
 * component it imports, draws one: `ScreenShell`'s `back`, a back row, the
 * glass close button, or the back and close glyphs.
 */

const APP = path.resolve(__dirname, "../app/(app)");
const ROOT = path.resolve(__dirname, "..");

const BACK_CONTROL =
  /\bback=\{|PinnedBackRow|<BackRow\b|GlassCloseButton|BackGlyph|CloseGlyph/;

/** Routes that draw no screen of their own, and why. */
const NO_SCREEN: Readonly<Record<string, string>> = {
  ask: "opens the Ask sheet over Chat home and dismisses back to it",
  chat: "forwards to Chat home or a thread and draws nothing",
};

function importedComponents(source: string): string[] {
  const files: string[] = [];
  for (const [, spec] of source.matchAll(/from "@\/(components\/[^"]+)"/g)) {
    for (const ext of [".tsx", ".ts", "/index.tsx"]) {
      const file = path.join(ROOT, `${spec}${ext}`);
      if (existsSync(file)) {
        files.push(file);
        break;
      }
    }
  }
  return files;
}

const SCREENS = readdirSync(APP)
  .filter((name) => name.endsWith(".tsx") && !name.startsWith("_"))
  .map((name) => name.replace(/\.tsx$/, ""))
  .filter((name) => !(name in NO_SCREEN));

describe("every pushed phone screen has a way back", () => {
  it("finds the screens", () => {
    expect(SCREENS.length).toBeGreaterThan(20);
  });

  it.each(SCREENS)("%s draws a back row or a close", (name) => {
    const source = readFileSync(path.join(APP, `${name}.tsx`), "utf8");
    const drawn =
      BACK_CONTROL.test(source) ||
      importedComponents(source).some((file) =>
        BACK_CONTROL.test(readFileSync(file, "utf8")),
      );
    expect(drawn).toBe(true);
  });
});

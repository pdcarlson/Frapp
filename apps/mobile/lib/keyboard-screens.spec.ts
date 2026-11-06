import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #3346: the screens whose text field the keyboard would cover go through
 * `KeyboardAvoidingArea`.
 *
 * `keyboard-avoiding-area.spec.tsx` pins what the area renders on each path,
 * and ESLint bans React Native's own `KeyboardAvoidingView` outside
 * `lib/keyboard.tsx`. Neither notices a screen that drops avoidance
 * altogether, which is how the chat composer ended up under the keyboard on the
 * first Play build. A static read, like `onboarding/auth-safe-area.spec.ts`.
 */

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

const SCREENS = [
  "(app)/chat-thread.tsx",
  "(auth)/sign-in.tsx",
  "(auth)/join.tsx",
  "(auth)/create-chapter.tsx",
];

describe("screens with a low text field avoid the keyboard (#3346)", () => {
  it.each(SCREENS)("%s renders inside KeyboardAvoidingArea", (file) => {
    const source = readFileSync(join(APP_DIR, file), "utf8");

    expect(source).toMatch(
      /import \{[^}]*\bKeyboardAvoidingArea\b[^}]*\} from "@\/lib\/keyboard";/,
    );
    expect(source).toMatch(/<KeyboardAvoidingArea\b/);
  });

  it("sign-in leaves iOS to its scroll view's own keyboard inset", () => {
    // Its ScrollView sets `automaticallyAdjustKeyboardInsets`; a padding view
    // around it on iOS would count the keyboard twice.
    const source = readFileSync(join(APP_DIR, "(auth)/sign-in.tsx"), "utf8");

    // As a JSX prop on its own line; the file's comments name it too.
    expect(source).toMatch(/^\s*automaticallyAdjustKeyboardInsets\s*$/m);
    expect(source).toMatch(
      /<KeyboardAvoidingArea\b[^>]*\biosInsetFromScrollView\b/,
    );
  });
});

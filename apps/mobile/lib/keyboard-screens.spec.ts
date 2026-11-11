import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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

// Listed by hand because the chat thread's field lives in a component
// (`components/chat/`), which the scan below does not follow.
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

  // #4010: the chat composer sits at the bottom inset, so on Android it
  // rises by the keyboard's reported height less that inset, rather than
  // through the library's view, which stopped short of the keyboard on
  // production. #4080: the auth screens have the same shape (the area runs to
  // the bottom of a SafeAreaView that pads every edge), so they rise the same
  // way and keep their focused field and pinned Continue above the keyboard.
  it.each([
    join(APP_DIR, "(app)/chat-thread.tsx"),
    join(APP_DIR, "..", "components/chat/message-thread-screen.tsx"),
    join(APP_DIR, "(auth)/sign-in.tsx"),
    join(APP_DIR, "(auth)/welcome.tsx"),
    join(APP_DIR, "(auth)/join.tsx"),
    join(APP_DIR, "(auth)/create-chapter.tsx"),
  ])("%s rises from the screen's bottom (#4010, #4080)", (path) => {
    const source = readFileSync(path, "utf8");
    // Bare, so `atScreenBottom={false}` or a condition can't pass.
    expect(source).toMatch(
      /<KeyboardAvoidingArea\b[^>]*\batScreenBottom\b(?!\s*=)/,
    );
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

/**
 * #3354: a route that draws a text field on the screen itself (React Native's
 * `TextInput`, or `OnboardingTextInput` built on it) goes through the area. A
 * field typed in a sheet uses `BottomSheetTextInput`, which coordinates with
 * the keyboard on its own, so it doesn't count; that is how Settings (accent)
 * and s18 check-in (manual code) keep their fields off the screen.
 */
function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.spec\.tsx$/.test(entry.name)
      ? [path]
      : [];
  });
}

const ON_SCREEN_FIELD =
  /import \{[^}]*\bTextInput\b[^}]*\} from "react-native";|\bOnboardingTextInput\b/;

const ROUTES_WITH_FIELDS = routeFiles(APP_DIR)
  .filter((path) => ON_SCREEN_FIELD.test(readFileSync(path, "utf8")))
  .map((path) => relative(APP_DIR, path));

describe("every route with an on-screen text field avoids the keyboard (#3354)", () => {
  it("finds the routes it guards", () => {
    // A regex that silently stopped matching would pass every case below.
    expect(ROUTES_WITH_FIELDS).toEqual(
      expect.arrayContaining(["(auth)/sign-in.tsx", "(auth)/join.tsx"]),
    );
  });

  it.each(ROUTES_WITH_FIELDS)(
    "%s renders inside KeyboardAvoidingArea",
    (file) => {
      expect(readFileSync(join(APP_DIR, file), "utf8")).toMatch(
        /<KeyboardAvoidingArea\b/,
      );
    },
  );

  it.each(["(app)/preferences.tsx", "(app)/check-in.tsx"])(
    "%s keeps its text fields in sheets",
    (file) => {
      // A moved route would pass the not.toContain below without a check.
      expect(existsSync(join(APP_DIR, file))).toBe(true);
      expect(ROUTES_WITH_FIELDS).not.toContain(file);
    },
  );
});

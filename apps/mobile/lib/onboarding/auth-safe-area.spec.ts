import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #3345: every `(auth)` screen draws inside a safe area.
 *
 * The `(auth)` stack renders with `headerShown: false`, and Android draws the
 * app edge to edge, so a screen that doesn't take the insets itself runs under
 * the status bar and puts its last control in the swipe-bar zone. Four of the
 * six screens (welcome, join, create chapter, terms) shipped that way in the
 * first Play build.
 *
 * A static read rather than six renders: the property is "this file wraps its
 * screen in a `SafeAreaView` that covers every edge", and a new
 * screen added to the folder is covered without anyone writing it a spec.
 */

const AUTH_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "app",
  "(auth)",
);

// Recursive, so a screen in a subfolder (a future `invite/[token].tsx`) is
// checked too. Paths come back relative to `(auth)`, with `/` on POSIX.
const screens = readdirSync(AUTH_DIR, {
  recursive: true,
  encoding: "utf8",
}).filter((file) => file.endsWith(".tsx") && !file.endsWith("_layout.tsx"));

describe("(auth) screens take the safe area (#3345)", () => {
  it("finds the screens to check", () => {
    // An empty folder read would pass every check below vacuously.
    expect(screens).toEqual(
      expect.arrayContaining([
        "sign-in.tsx",
        "chapter-picker.tsx",
        "welcome.tsx",
        "join.tsx",
        "create-chapter.tsx",
        "terms.tsx",
      ]),
    );
  });

  it.each(screens)(
    "%s wraps its screen in a SafeAreaView covering every edge",
    (file) => {
      const source = readFileSync(join(AUTH_DIR, file), "utf8");

      expect(source).toMatch(
        /import \{[^}]*\bSafeAreaView\b[^}]*\} from "react-native-safe-area-context";/,
      );
      const edges = [
        ...source.matchAll(/<SafeAreaView[^>]*?edges=\{\[([^\]]*)\]\}/g),
      ];
      expect(edges.length).toBeGreaterThan(0);
      for (const [, list] of edges) {
        for (const edge of ["top", "right", "bottom", "left"]) {
          expect(list).toContain(`"${edge}"`);
        }
      }
    },
  );
});

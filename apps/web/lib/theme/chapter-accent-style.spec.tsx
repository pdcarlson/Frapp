import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  deriveSignetPalette,
  signetAccentSemanticVars,
} from "@repo/chapter-theme";

import {
  ACCENT_CACHE_CHAPTER_ATTR,
  ACCENT_CACHE_STYLE_ID,
  chapterAccentCss,
  type AccentTokenName,
} from "./accent-cache";
import { ChapterAccentStyle } from "./chapter-accent-style";

const CHAPTER = "22222222-2222-4222-8222-222222222222";
const MEMBER = "11111111-1111-4111-8111-111111111111";
const TOKENS = signetAccentSemanticVars(
  deriveSignetPalette("#3E7BFA").palette,
) as Record<AccentTokenName, string>;

describe("ChapterAccentStyle", () => {
  it("renders nothing when there is no cached accent", () => {
    // The uncached cold load, a signed-out visitor, a member with no chapter:
    // `signet.css`'s house default stands, which is what those surfaces want.
    const { container } = render(<ChapterAccentStyle paint={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("emits the cached rule with the id and chapter the client looks for", () => {
    const { container } = render(
      <ChapterAccentStyle paint={{ chapterId: CHAPTER, tokens: TOKENS }} />,
    );
    const style = container.querySelector("style");
    expect(style).not.toBeNull();
    expect(style!.id).toBe(ACCENT_CACHE_STYLE_ID);
    expect(style!.getAttribute(ACCENT_CACHE_CHAPTER_ATTR)).toBe(CHAPTER);
    expect(style!.innerHTML).toBe(chapterAccentCss(TOKENS));
  });

  it("puts no member id in the DOM", () => {
    // The client's only question is which chapter the rule is for — two members
    // of a chapter share an accent. The uid gates the *read*, server-side.
    const { container } = render(
      <ChapterAccentStyle paint={{ chapterId: CHAPTER, tokens: TOKENS }} />,
    );
    expect(container.innerHTML).not.toContain(MEMBER);
  });
});

describe("it is rendered under (dashboard) and nowhere else", () => {
  /**
   * `spec/ui/brand-identity.md` §2 forbids the mark ever taking a chapter
   * accent, and `spec/ui/web-dashboard/README.md` puts every pre-auth screen on
   * the house default because it has no tenant. Both hold today only because
   * this component is mounted inside the `(dashboard)` group.
   *
   * That was prose. Hoisting it to the root layout — the obvious move, to "let
   * `/join` have it too" — would paint a chapter's colour on `/sign-in`, and
   * nothing would have objected. This is the objection.
   *
   * A walk rather than a ledger, for the same reason `lib/date-call-sites.spec.ts`
   * gives: the defect is a *new* file written from the habit, and a ledger only
   * covers files somebody remembered to add.
   */
  const APP = join(__dirname, "..", "..", "app");

  function sourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        found.push(...sourceFiles(path));
        continue;
      }
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      found.push(path);
    }
    return found;
  }

  it("is imported by the dashboard layout only", () => {
    const importers = sourceFiles(APP).filter((path) =>
      /\bChapterAccentStyle\b/.test(readFileSync(path, "utf8")),
    );
    expect(importers.map((path) => path.slice(APP.length + 1))).toEqual([
      join("(dashboard)", "layout.tsx"),
    ]);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_NOTES } from "@repo/validation";
import { describe, expect, it } from "vitest";

/**
 * `/about` and `/changelog` (#3817). Source-reading, like `page.spec.ts`,
 * because `apps/landing` has no DOM test environment.
 */
const landingRoot = process.cwd();
const read = (file: string) => readFileSync(join(landingRoot, file), "utf8");

function withoutComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const about = withoutComments(read("app/about/page.tsx"));
const changelog = withoutComments(read("app/changelog/page.tsx"));
const shell = withoutComments(read("components/site-page.tsx"));
const header = withoutComments(read("components/home/site-header.tsx"));
const footer = withoutComments(read("components/home/site-footer.tsx"));
const sitemap = read("app/sitemap.ts");

describe("about and changelog pages", () => {
  it("keep the landing copy rules: no em dashes in rendered copy", () => {
    for (const [file, source] of [
      ["about", about],
      ["changelog", changelog],
      ["site-page", shell],
    ]) {
      expect(source, `${file} renders an em dash`).not.toContain("—");
    }
    // The changelog renders release-notes copy too.
    for (const note of RELEASE_NOTES) {
      for (const line of [note.title, ...note.changes]) {
        expect(line).not.toContain("—");
      }
    }
  });

  it("render the changelog from the shared release notes, not a copy", () => {
    expect(changelog).toMatch(
      /import \{[^}]*RELEASE_NOTES[^}]*\} from "@repo\/validation"/,
    );
    expect(changelog).toContain("RELEASE_NOTES.map(");
    expect(changelog).toContain("formatReleaseNoteDate(note.date)");
  });

  it("sit inside the storefront header and footer, with a skip link", () => {
    expect(about).toMatch(/<SitePage\b/);
    expect(changelog).toMatch(/<SitePage\b/);
    expect(shell).toMatch(/<SiteHeader\b/);
    expect(shell).toMatch(/<SiteFooter\b/);
    expect(shell).toContain("Skip to content");
    expect(shell).toMatch(/<main id="top"/);
  });

  it("are linked from the nav, the footer and the sitemap", () => {
    for (const source of [header, footer]) {
      expect(source).toContain('"/about"');
      expect(source).toContain('"/changelog"');
    }
    expect(sitemap).toContain("${baseUrl}/about");
    expect(sitemap).toContain("${baseUrl}/changelog");
  });

  it("root the in-page anchors at / so they work from a subpage", () => {
    for (const source of [header, footer]) {
      expect(source).not.toMatch(/href[=:]\s*"#(product|pricing)"/);
      expect(source).toContain('"/#product"');
      expect(source).toContain('"/#pricing"');
    }
  });
});

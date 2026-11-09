import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RELEASE_NOTES, formatReleaseNoteDate } from "@repo/validation";
import { describe, expect, it } from "vitest";
import AboutPage from "./about/page";
import ChangelogPage from "./changelog/page";
import sitemap from "./sitemap";

/**
 * `/about` and `/changelog` (#3817). These render the pages to markup and read
 * what a visitor gets, rather than reading source, so a page that stops
 * drawing an entry or a section fails here.
 */
const render = (page: () => React.ReactNode) =>
  renderToStaticMarkup(createElement(page));

/** The HTML entities React escapes, back to the characters a visitor reads. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const about = render(AboutPage);
const changelog = render(ChangelogPage);

describe("/changelog", () => {
  it("shows every entry and every line of the app's What's new", () => {
    const shown = text(changelog);
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
    for (const note of RELEASE_NOTES) {
      expect(shown).toContain(formatReleaseNoteDate(note.date));
      expect(changelog).toContain(`dateTime="${note.date}"`);
      expect(shown).toContain(note.title);
      for (const change of note.changes) expect(shown).toContain(change);
    }
    expect(shown).not.toContain("Nothing here yet.");
  });
});

describe("/about", () => {
  it("covers what Frapp is, who it's for, who builds it, and the mission", () => {
    const shown = text(about);
    for (const heading of [
      "What Frapp is",
      "Who it's for",
      "Who builds it",
      "Our mission",
      "Get in touch",
    ]) {
      expect(shown, `About lost its "${heading}" section`).toContain(heading);
    }
    expect(about).toContain('href="mailto:team@frapp.live"');
  });
});

describe("both pages", () => {
  it.each([
    ["about", about],
    ["changelog", changelog],
  ])("/%s keeps the landing copy rules: no em dashes", (_route, html) => {
    expect(text(html)).not.toContain("—");
  });

  it.each([
    ["about", about],
    ["changelog", changelog],
  ])("/%s draws the storefront chrome with rooted anchors", (_route, html) => {
    expect(html).toContain("Skip to content");
    expect(html).toMatch(/<main id="top"/);
    for (const href of ["/#product", "/#pricing", "/about", "/changelog"]) {
      expect(html).toContain(`href="${href}"`);
    }
    // A bare anchor here would resolve against this page, not the homepage.
    expect(html).not.toMatch(/href="#(product|pricing)"/);
  });

  it("are in the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://frapp.live/about");
    expect(urls).toContain("https://frapp.live/changelog");
  });
});

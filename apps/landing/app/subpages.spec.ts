import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RELEASE_NOTES,
  formatReleaseNoteDate,
  releaseNoteGroups,
} from "@repo/validation";
import { describe, expect, it } from "vitest";
import AboutPage, { metadata as aboutMetadata } from "./about/page";
import ChangelogPage, { metadata as changelogMetadata } from "./changelog/page";
import Home from "./page";
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
const home = render(Home);

/** The markup of one landmark, so header and footer are checked apart. */
function landmark(html: string, tag: "header" | "footer"): string {
  const start = html.indexOf(`<${tag}`);
  const end = html.indexOf(`</${tag}>`, start);
  expect(start, `no <${tag}> rendered`).toBeGreaterThan(-1);
  return html.slice(start, end);
}

/** Every string a route's `<head>` carries: title, description, OG, Twitter. */
function headStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(headStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(headStrings);
  }
  return [];
}

describe("/changelog", () => {
  it("shows every entry and every line of the app's What's new", () => {
    const shown = text(changelog);
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
    for (const note of RELEASE_NOTES) {
      expect(shown).toContain(formatReleaseNoteDate(note.date));
      expect(changelog).toContain(`dateTime="${note.date}"`);
      expect(shown).toContain(note.title);
      for (const group of releaseNoteGroups(note)) {
        if (group.label) expect(shown).toContain(group.label);
        for (const change of group.lines) expect(shown).toContain(change);
      }
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
      // A heading with no text under it is a section in name only.
      const escaped = heading.replace("'", "&#x27;");
      expect(
        about,
        `About's "${heading}" section has no paragraph`,
      ).toMatch(new RegExp(`>${escaped}</h2><p[^>]*>[^<]{20,}`));
    }
    expect(about).toContain('href="mailto:team@frapp.live"');
  });

  it("points at Support from its own contact section (#3869)", () => {
    // The footer links Support on every page, so only the page body counts.
    const main = about.slice(about.indexOf("<main"), about.indexOf("</main>"));
    const contact = main.slice(main.indexOf(">Get in touch</h2>"));
    expect(contact).toContain('href="mailto:team@frapp.live"');
    expect(contact).toMatch(/href="\/support"[^>]*>Get support</);
  });
});

describe("both pages", () => {
  it.each([
    ["about", about],
    ["changelog", changelog],
  ])("/%s keeps the landing copy rules: no em dashes", (_route, html) => {
    // Raw markup too, so attribute text (aria-label, alt, title) is covered:
    // React writes an em dash through unescaped.
    expect(html).not.toContain("\u2014");
    expect(text(html)).not.toContain("\u2014");
  });

  it.each([
    ["about", aboutMetadata],
    ["changelog", changelogMetadata],
  ])("/%s carries no em dash in its <head> either", (_route, metadata) => {
    const strings = headStrings(metadata);
    expect(strings.length).toBeGreaterThan(0);
    for (const value of strings) expect(value).not.toContain("\u2014");
  });

  it.each([
    ["about", about],
    ["changelog", changelog],
  ])("/%s draws the storefront chrome with rooted anchors", (_route, html) => {
    expect(html).toContain("Skip to content");
    expect(html).toMatch(/<main id="top"/);
    for (const tag of ["header", "footer"] as const) {
      const part = landmark(html, tag);
      for (const href of ["/#product", "/#pricing", "/about", "/changelog"]) {
        expect(part, `${tag} lacks ${href}`).toContain(`href="${href}"`);
      }
      // A bare anchor here would resolve against this page, not the homepage.
      expect(part).not.toMatch(/href="#(product|pricing)"/);
    }
  });

  it("are linked from the homepage, whose own anchors stay bare", () => {
    // Bare, so a click on `/?utm_source=...` scrolls and keeps the query
    // (components/home/site-chrome.tsx).
    for (const tag of ["header", "footer"] as const) {
      const part = landmark(home, tag);
      for (const href of ["#product", "#pricing", "/about", "/changelog"]) {
        expect(part, `homepage ${tag} lacks ${href}`).toContain(
          `href="${href}"`,
        );
      }
      expect(part).not.toMatch(/href="\/#(product|pricing)"/);
    }
  });

  it("are in the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://frapp.live/about");
    expect(urls).toContain("https://frapp.live/changelog");
  });
});

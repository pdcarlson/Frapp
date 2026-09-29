import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No surface renders `greek_letters` directly (#2876).
 *
 * A chapter can turn its Greek letters off, and the only thing that makes that
 * hold everywhere is that every surface asks `chapter-mark.ts` what to show.
 * One component reading `branding.greek_letters` into its JSX would put ΦΓΔ
 * back in front of a FIJI chapter, and nothing else would notice. So this
 * lists every product file that may touch the field at all, each with the
 * reason it isn't a renderer, and fails on any other.
 *
 * A file is matched on the field name in either spelling, comments included:
 * a docblock that names the field is cheaper to reword than to reason about.
 * Specs, generated contract files and build output are skipped. Because the
 * list is per file, a second check looks inside every file, the allowed ones
 * included, for the field printed into JSX, a template string or a
 * concatenation (`printsTheField`).
 */
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCANNED = ["apps/web", "apps/mobile", "apps/api/src", "apps/landing", "packages"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".next", ".expo", "coverage"]);
const FIELD = /greek_letters|greekLetters/;

const ALLOWED: Record<string, string> = {
  "packages/validation/src/chapter-mark.ts":
    "the resolver itself: the one place that decides whether the letters show",
  "packages/validation/src/index.ts": "the branding schema declares the field",
  "packages/hooks/src/chapter-identity.ts":
    "the wizards' identity form and the onboarding payload it builds",
  "packages/hooks/src/use-chapters.ts": "the onboarding request type",
  "apps/api/src/interface/dtos/chapter-config.dto.ts":
    "the DTO validates the field on write",
  "apps/api/src/application/services/chapter-onboarding.service.ts":
    "stores the field and files the directory request; the welcome message goes through chapterTextMark",
  "apps/web/components/onboarding/chapter-wizard.tsx":
    "the wizard's input for the field, and its preview feeds resolveChapterMark",
  "apps/web/components/settings/settings-org-tab.tsx":
    "the Settings input for the field",
  "apps/web/components/settings/settings-page.tsx":
    "reads the stored field into the Settings form",
  "apps/web/components/settings/settings-chapter-mark-card.tsx":
    "the Settings preview, which feeds resolveChapterMark",
  "apps/mobile/app/(auth)/create-chapter.tsx":
    "the mobile wizard's input for the field",
};

/**
 * Whether source prints the field rather than binding it: a JSX child
 * expression (`{…greekLetters…}` not preceded by `=`, so not an attribute), a
 * template interpolation, or string concatenation. A prop that prints it
 * (`label={…}`) or an expression wrapped across lines isn't caught; review
 * still reads the allowed files.
 */
function printsTheField(source: string): boolean {
  const field = "(?:greek_letters|greekLetters)";
  return [
    // JSX child: `{…}` on one line, not an attribute value (`={`) and not a
    // template interpolation (`${`).
    new RegExp(`(?<![=$\\w])\\{[^{}\\n]*\\b${field}\\b[^{}\\n]*\\}`),
    // Template interpolation: `${…}`
    new RegExp(`\\$\\{[^}\\n]*\\b${field}\\b[^}\\n]*\\}`),
    // Concatenation: `"…" + x.greek_letters` or `x.greek_letters + "…"`
    new RegExp(`["'\`]\\s*\\+\\s*[\\w.?]*\\b${field}\\b|\\b${field}\\b\\s*\\+\\s*["'\`]`),
  ].some((pattern) => pattern.test(source));
}

function isSource(path: string): boolean {
  if (!/\.(ts|tsx)$/.test(path)) return false;
  if (/\.spec\.tsx?$|\.test\.tsx?$|\.d\.ts$/.test(path)) return false;
  // The generated OpenAPI client describes the wire, it renders nothing.
  return !path.endsWith("packages/api-sdk/src/types.ts");
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (isSource(path)) out.push(path);
  }
}

describe("greek_letters readers (#2876)", () => {
  const files: string[] = [];
  for (const root of SCANNED) walk(join(REPO_ROOT, root), files);
  const readers = files
    .filter((path) => FIELD.test(readFileSync(path, "utf8")))
    .map((path) => relative(REPO_ROOT, path).split("\\").join("/"))
    .sort();

  it("finds files to scan, so an empty walk can't pass", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("touches the field only in the editors and the resolver", () => {
    const unexpected = readers.filter((path) => !(path in ALLOWED));
    // A new file here is almost certainly a renderer. Show the chapter mark
    // through `resolveChapterMark` / `chapterTextMark` instead; if it really is
    // an editor, add it to ALLOWED with the reason.
    expect(unexpected).toEqual([]);
  });

  it("never prints the field, even in a file allowed to touch it", () => {
    // ALLOWED is per file, so on its own it can't see a render added inside
    // an editor (`<p>Letters: {identity.greekLetters}</p>` in the wizard). An
    // editor binds the field to an input (`value={…}`); printing it means a
    // JSX child expression or a template string, which is what this catches.
    // The resolver is exempt: handing the letters on, under the opt-out, is
    // its job.
    const printers = readers
      .filter((path) => path !== "packages/validation/src/chapter-mark.ts")
      .filter((path) =>
        printsTheField(readFileSync(join(REPO_ROOT, path), "utf8")),
      );
    expect(printers).toEqual([]);
  });

  it("recognizes the ways a file prints the field, and not the ways an editor binds it", () => {
    // Pins the patterns themselves, so a later edit can't quietly narrow them.
    const printed = [
      "<p>{identity.greekLetters}</p>",
      '<p className="text-xs">Letters: {identity.greekLetters}</p>',
      "<span>{branding.greek_letters ?? \"\"}</span>",
      "<p>\n  {branding.greek_letters}\n</p>",
      "const t = `Welcome to ${branding.greek_letters}`;",
      'const t = "Welcome to " + branding.greek_letters;',
    ];
    const bound = [
      "value={identity.greekLetters}",
      'onChange={(e) => set("greekLetters", e.target.value)}',
      "setGreekLetters(branding.greek_letters ?? \"\");",
      "if (letters !== undefined) brandingDiff.greek_letters = letters;",
      "greek_letters: identity.greekLetters.trim() || undefined,",
    ];
    expect(printed.filter((line) => !printsTheField(line))).toEqual([]);
    expect(bound.filter(printsTheField)).toEqual([]);
  });

  it("lists no file that no longer touches the field", () => {
    expect(Object.keys(ALLOWED).filter((path) => !readers.includes(path))).toEqual(
      [],
    );
  });
});

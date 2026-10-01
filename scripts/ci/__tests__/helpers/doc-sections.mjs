// Gate and alert messages send a reader to a section of a repo doc, written as
// `<doc path> § <heading>`. lychee checks links inside markdown, never a string
// in a script, so a renamed heading or a moved doc would leave such a message
// pointing at nothing with every test green. These helpers read the doc itself.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** The doc's heading titles, outside code fences, with backticks stripped. */
export function docHeadings(docPath) {
  const headings = [];
  let fenced = false;
  for (const line of readFileSync(join(REPO_ROOT, docPath), "utf8").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) headings.push(match[1].replaceAll("`", ""));
  }
  return headings;
}

/**
 * Asserts that `text` cites `heading` in `docPath` (the heading may be quoted
 * in backticks), that the doc exists, and that it has a heading starting with
 * those words (`--include-all` matches "`--include-all` (recovery only)").
 */
export function assertCitesSection(text, docPath, heading) {
  assert.ok(text.includes(docPath), `expected the message to name ${docPath}:\n${text}`);
  const quoted = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(text, new RegExp(`§ \`?${quoted}\`?`), `expected the message to cite § ${heading}`);
  assert.ok(existsSync(join(REPO_ROOT, docPath)), `${docPath} does not exist`);
  assert.ok(
    docHeadings(docPath).some((title) => title.startsWith(heading)),
    `${docPath} has no heading starting "${heading}"`,
  );
}

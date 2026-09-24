// Which lines of a source file are copy, for the name locks.
//
// frapp-mobile-copy.test.mjs and frapp-api-copy.test.mjs both walk a surface
// for a product name that must not ship, and neither may count a comment that
// names the design system. This is the one rule both read by, so a fix to it
// reaches both.

/**
 * Why lines and not a scanner. Telling a comment from a string, a regex or
 * JSX text takes a parser, and this job runs with node built-ins only (no
 * `npm ci`). A hand-rolled scanner was tried first, and each of seven review
 * rounds found another way for one misread (a `/*` in JSX text, a stray
 * backtick, a regex read as division, a lone `\r`) to hide copy many lines
 * below it. So the rule reads each line on its own and trusts only the
 * comment a line starts with:
 * - a `//` line is comment to its end;
 * - a line starting `/*`, `{/*` or `*` (a block comment, a JSX comment, a
 *   JSDoc continuation) is comment up to its first `*\/`, code after.
 * Anything else counts as copy, including a comment after code (`x(); //
 * Signet`) and a block comment's star-less continuation line: those report,
 * so the rule fails closed there. Lines break where JavaScript breaks them
 * (`\r\n`, `\n`, `\r`, U+2028, U+2029), so a lone `\r` can't join a comment
 * line to the code after it.
 *
 * The blind spot: copy on a line that itself starts with `//`, `*`, `/*` or
 * `{/*`, such as a template literal line beginning `* ` or JSX text beginning
 * `//`. The last fixture in frapp-mobile-copy.test.mjs pins it, so widening or
 * closing it is deliberate.
 */
export const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/;
export const LEADING_COMMENT = /^\s*(?:\/\/|\{?\/\*|\*)/;

/** Whether `column` of `line` sits in the comment the line starts with. */
export function inLeadingComment(line, column) {
  const lead = line.match(LEADING_COMMENT);
  if (!lead) return false;
  if (lead[0].endsWith("//")) return true;
  // A `*` line may be the `*\/` that closes the block, so search from the star.
  const from = lead[0].endsWith("/*") ? lead[0].length : lead[0].length - 1;
  const close = line.indexOf("*/", from);
  return close === -1 || column < close;
}

/** Every match of `pattern`, by file and line, that isn't in its line's leading comment. */
export function copyMatches(files, pattern) {
  const found = [];
  for (const { rel, source } of files) {
    for (const [index, line] of source.split(LINE_BREAK).entries()) {
      for (const match of line.matchAll(pattern)) {
        if (!inLeadingComment(line, match.index)) {
          found.push({ rel, line: index + 1, text: line, match });
        }
      }
    }
  }
  return found;
}

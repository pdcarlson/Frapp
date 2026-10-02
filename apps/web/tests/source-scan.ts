import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import ts from "typescript";

/**
 * The product source of both Next surfaces, for the call-site scans that ban a
 * class shape everywhere it could ship (`components/shared/status-tint-call-sites`,
 * `components/shared/elevation-call-sites` and `components/ui/type-scale-call-sites`).
 *
 * One copy, for the reason `signet-contrast.ts` keeps one seed corpus: two scans
 * that each owned a `ROOTS` list could drift, and a root added to one would
 * silently fall out of the other's ban. (`lib/date-call-sites.spec.ts` keeps
 * its own walker: it scans `apps/web` alone, with a narrower comment stripper,
 * so folding it in would change what that guard reads.)
 */

/** The repo root, from `apps/web/tests/`. */
export const REPO = join(__dirname, "..", "..", "..");

/** Where product code lives in each Next app; `tests/` is harness code. */
export const ROOTS = [
  "apps/web/app",
  "apps/web/components",
  "apps/web/hooks",
  "apps/web/lib",
  "apps/landing/app",
  "apps/landing/components",
  "apps/landing/lib",
] as const;

const TS_SOURCE = /\.tsx?$/;
const SPEC = /\.(spec|test)\.tsx?$/;

/**
 * `withFileTypes`, as in `lib/date-call-sites.spec.ts`, so a dangling symlink
 * is skipped rather than crashing the suite. A root that stops existing throws
 * instead of being skipped, because a scan of nothing passes forever.
 */
function walk(dir: string, source: RegExp): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      found.push(...walk(path, source));
    } else if (entry.isFile() && source.test(entry.name)) {
      if (!SPEC.test(entry.name)) found.push(path);
    }
  }
  return found;
}

/** Every non-spec file under `ROOTS` whose name matches `source` (TS by default). */
export function productSourceFiles(source: RegExp = TS_SOURCE): string[] {
  return ROOTS.flatMap((root) => walk(join(REPO, root), source)).sort();
}

/**
 * The text a class list can live in, for a scan that must not be blinded by a
 * comment marker inside a string (#2842, #3088).
 *
 * A regex comment stripper cannot see strings, so a `"image/*"` opens a
 * "comment" that runs to the next `*\/` and hides every class in between, and
 * a `//` inside a template string drops the rest of its line. Script files are
 * therefore parsed instead: only their string literals and template-literal
 * text are returned, so a match cannot cross from one literal into the next
 * and a comment is never read at all. CSS keeps a `/* *\/` regex, because CSS
 * has no `//` comment and a `/*` inside a CSS string is not a shape this
 * codebase writes; it comes back as one entry. Anything else (`.mdx`) is
 * returned whole, which can only make a scan stricter.
 */
export function classLiterals(path: string): string[] {
  const text = readFileSync(path, "utf8");
  const ext = extname(path);
  if (ext === ".css") return [text.replace(/\/\*[\s\S]*?\*\//g, "")];
  const kind = SCRIPT_KINDS[ext];
  if (kind === undefined) return [text];
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
  const parts: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      parts.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      // One class list, its interpolations read as a gap: a tint before a
      // `${…}` and a text after it are still on the same element.
      parts.push(
        [
          node.head.text,
          ...node.templateSpans.map((span) => span.literal.text),
        ].join(" "),
      );
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return parts;
}

/** {@link classLiterals}, one per line, for a scan that matches text. */
export function classSourceText(path: string): string {
  return classLiterals(path).join("\n");
}

/**
 * A script file's code with its comments removed, for a guard that pins
 * structure (a JSX attribute, a function body) and so can't read literals
 * alone. The comments are the ones the parser finds, so a `/*` or `//` inside
 * a string, a template or JSX text is left as it is (#3088).
 */
export function codeWithoutComments(path: string): string {
  const text = readFileSync(path, "utf8");
  const kind = SCRIPT_KINDS[extname(path)];
  if (kind === undefined) {
    throw new Error(`codeWithoutComments reads script files, not ${path}`);
  }
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  // JSX text is not trivia, so a `//` that opens it is prose, not a comment.
  const jsxText: Array<[number, number]> = [];
  const comments = new Map<number, number>();
  const collect = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) comments.set(range.pos, range.end);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      jsxText.push([node.pos, node.end]);
      return;
    }
    collect(ts.getLeadingCommentRanges(text, node.pos));
    collect(ts.getTrailingCommentRanges(text, node.end));
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  const inJsxText = (pos: number) =>
    jsxText.some(([start, end]) => pos >= start && pos < end);
  // One forward pass, skipping whatever an earlier cut already covers: the
  // walk also asks inside a JSDoc block, which reports a `// …` or `{@link}`
  // in it as a second, nested range.
  let code = "";
  let cursor = 0;
  for (const [pos, end] of [...comments].sort(([a], [b]) => a - b)) {
    if (pos < cursor || inJsxText(pos)) continue;
    code += text.slice(cursor, pos);
    cursor = end;
  }
  return code + text.slice(cursor);
}

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
  ".mjs": ts.ScriptKind.JS,
};

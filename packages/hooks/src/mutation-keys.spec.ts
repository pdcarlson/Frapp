/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every write in this package names its feature (#3393).
 *
 * The shared query-error reporter (`@repo/observability`'s
 * `createQueryErrorReporter`) groups a failed mutation in Sentry by the first
 * element of its `mutationKey`, and one with no key reports as `unkeyed`,
 * which pools every feature's failures into one issue per status class. The
 * root must be a string literal of the shape the reporter sends (its
 * `KEY_ROOT_RE`, copied below); a root built at runtime could be an id. Later
 * elements are never read.
 *
 * A parse of the source rather than a render of each hook: there are over a
 * hundred, most needing their own client mocks, and the property is a fact
 * about the call site. A key named by a constant or a helper in the same file
 * is followed to its definition; a ternary must root both branches.
 */
const SRC = dirname(fileURLToPath(import.meta.url));
/** `KEY_ROOT_RE` in `packages/observability/src/query-errors.ts`. */
const KEY_ROOT = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

/** Top-level `const X = …` and `function X(…)` in a file, by name. */
function declarations(file: ts.SourceFile): Map<string, ts.Node> {
  const found = new Map<string, ts.Node>();
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          found.set(decl.name.text, decl.initializer);
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      found.set(statement.name.text, statement);
    }
  }
  return found;
}

/**
 * The key's root, or why it has none the reporter would send. Follows `as
 * const`, parentheses, a same-file constant or helper (its returned array),
 * a spread of another key, and both branches of a ternary.
 */
function rootProblem(
  node: ts.Node,
  decls: Map<string, ts.Node>,
  seen = new Set<ts.Node>(),
): string | null {
  if (seen.has(node)) return "a key that refers to itself";
  seen.add(node);
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return rootProblem(node.expression, decls, seen);
  }
  if (ts.isConditionalExpression(node)) {
    // Each branch is its own path: both may reach the same constant.
    return (
      rootProblem(node.whenTrue, decls, new Set(seen)) ??
      rootProblem(node.whenFalse, decls, new Set(seen))
    );
  }
  if (ts.isArrayLiteralExpression(node)) {
    const first = node.elements[0];
    // `[...parentKey, "more"]` takes its root from the key it extends.
    if (first && ts.isSpreadElement(first)) {
      return rootProblem(first.expression, decls, seen);
    }
    if (!first || !ts.isStringLiteral(first)) {
      return "a root that is not a string literal";
    }
    return KEY_ROOT.test(first.text) ? null : `the root "${first.text}"`;
  }
  const name = ts.isIdentifier(node)
    ? node.text
    : ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      ? node.expression.text
      : null;
  const decl = name ? decls.get(name) : undefined;
  if (!decl) return `a key the scan can't follow (${node.getText()})`;
  if (ts.isArrowFunction(decl) || ts.isFunctionDeclaration(decl)) {
    const body = decl.body;
    if (body && !ts.isBlock(body)) return rootProblem(body, decls, seen);
    const returned = body?.statements.find(ts.isReturnStatement)?.expression;
    return returned
      ? rootProblem(returned, decls, seen)
      : `a helper with no returned key (${name})`;
  }
  return rootProblem(decl, decls, seen);
}

interface Finding {
  where: string;
  problem: string;
}

function scan(): { calls: number; findings: Finding[] } {
  let calls = 0;
  const findings: Finding[] = [];
  for (const path of sourceFiles(SRC)) {
    const file = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const decls = declarations(file);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "useMutation"
      ) {
        calls++;
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        const where = `${relative(SRC, path)}:${line + 1}`;
        const options = node.arguments[0];
        if (!options || !ts.isObjectLiteralExpression(options)) {
          findings.push({ where, problem: "options the scan can't read" });
        } else {
          const key = options.properties.find(
            (p): p is ts.PropertyAssignment =>
              ts.isPropertyAssignment(p) &&
              ts.isIdentifier(p.name) &&
              p.name.text === "mutationKey",
          );
          const problem = key
            ? rootProblem(key.initializer, decls)
            : "no mutationKey";
          if (problem) findings.push({ where, problem });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return { calls, findings };
}

describe("mutation keys (#3393)", () => {
  const { calls, findings } = scan();

  it("finds the package's mutations", () => {
    // A scan that silently matched nothing would pass the check below.
    expect(calls).toBeGreaterThan(100);
  });

  it("gives every useMutation a mutationKey with a literal, identifier-shaped root", () => {
    expect(findings).toEqual([]);
  });
});

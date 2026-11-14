/**
 * Every `queryFn` that calls the API hands TanStack's `signal` to the call
 * (#3433), so a cancelled query (a `refetch()` over one in flight, an
 * `invalidateQueries`, a screen that unmounts) aborts its request instead of
 * leaving it open beside the next one. The SDK client aborts the request when
 * that signal does (`packages/api-sdk/src/client.ts`).
 *
 * A source scan rather than a render of each hook, for the reason
 * `mutation-keys.spec.ts` gives: there are over a hundred, and the property is
 * a fact about the call site. A `queryFn` counts when its body calls a client
 * method (`.GET(`, `.POST(`, …) directly; each such call must pass an init
 * object naming `signal`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

const CLIENT_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * Files left out while an open PR rewrites the same hooks, so this change
 * doesn't conflict with it. Each entry goes once that PR merges.
 */
const PENDING: Record<string, string> = {
  "use-chat-sidebar.ts": "#5026 (channel sort) is open on this hook",
  "use-notifications.ts": "#5024 (cold open) is open on this hook",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

function namesSignal(node: ts.Expression | undefined): boolean {
  return (
    node !== undefined &&
    ts.isObjectLiteralExpression(node) &&
    node.properties.some((property) => property.name?.getText() === "signal")
  );
}

/** Each client call in `fn` that doesn't pass `signal`, as `file:line`. */
function unsignalledCalls(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  file: ts.SourceFile,
  name: string,
): string[] {
  const missing: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      CLIENT_METHODS.has(node.expression.name.text) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      if (!namesSignal(node.arguments[1])) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        missing.push(`${name}:${line + 1}`);
      }
    }
    // A nested function is its own scope (a mutation's callback, say).
    if (node !== fn && ts.isFunctionLike(node)) return;
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return missing;
}

function offenders(): string[] {
  return sourceFiles(SRC).flatMap((path) => {
    const name = relative(SRC, path);
    if (name in PENDING) return [];
    const file = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText() === "queryFn" &&
        (ts.isArrowFunction(node.initializer) ||
          ts.isFunctionExpression(node.initializer))
      ) {
        found.push(...unsignalledCalls(node.initializer, file, name));
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return found;
  });
}

describe("queryFn signal (#3433)", () => {
  it("passes TanStack's signal to every API call a queryFn makes", () => {
    expect(offenders()).toEqual([]);
  });

  it("still finds the files it leaves out, so a stale entry is noticed", () => {
    const names = sourceFiles(SRC).map((path) => relative(SRC, path));
    for (const pending of Object.keys(PENDING)) {
      expect(names).toContain(pending);
    }
  });
});

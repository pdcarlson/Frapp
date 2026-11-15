/**
 * Every `queryFn` that calls the API hands TanStack's `signal` to the call
 * (#3433), so a cancelled query (a `refetch()` over one in flight, an
 * `invalidateQueries`, the last observer unmounting) aborts its request
 * instead of leaving it open beside the next one. openapi-fetch puts the
 * init's `signal` on the request; the one exception is a first-screen read
 * the batch middleware answers from `GET /v1/bootstrap`
 * (`packages/api-sdk/src/first-screen-batch.ts`), which the batch holds to
 * its own short timeout rather than the caller's signal.
 *
 * A source scan rather than a render of each hook, for the reason
 * `mutation-keys.spec.ts` gives: there are over a hundred, and the property is
 * a fact about the call site. Inside a `queryFn`, callbacks included (a
 * `Promise.all` over `.map`), each client call (`.GET("/v1/…", …)`) must pass
 * an init naming `signal`, and each helper handed `client` must be handed
 * `signal` too.
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
 * doesn't conflict with it. Each entry goes once that PR merges (#5029); the
 * last test fails once an entry has nothing left to excuse.
 */
const PENDING: Record<string, string> = {};

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

const isIdentifier = (node: ts.Node, name: string): boolean =>
  ts.isIdentifier(node) && node.text === name;

/** Each call in `fn` that drops the signal, as `file:line`. */
function unsignalledCalls(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  file: ts.SourceFile,
  name: string,
): string[] {
  const missing: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const clientCall =
        ts.isPropertyAccessExpression(node.expression) &&
        CLIENT_METHODS.has(node.expression.name.text) &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteralLike(node.arguments[0]);
      const handsOffClient =
        node.arguments.some((arg) => isIdentifier(arg, "client")) &&
        !node.arguments.some((arg) => isIdentifier(arg, "signal"));
      if ((clientCall && !namesSignal(node.arguments[1])) || handsOffClient) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        missing.push(`${name}:${line + 1}`);
      }
    }
    // Callbacks inside the queryFn run as part of it, so they are read too.
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return missing;
}

function offenders(): string[] {
  return sourceFiles(SRC).flatMap((path) => {
    const name = relative(SRC, path);
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
  const found = offenders();
  const pending = (offender: string) => offender.split(":")[0]! in PENDING;

  it("passes TanStack's signal to every API call a queryFn makes", () => {
    expect(found.filter((offender) => !pending(offender))).toEqual([]);
  });

  it.each(Object.keys(PENDING))(
    "still has a reason to leave %s out (drop the entry once it passes)",
    (pendingFile) => {
      expect(
        found.some((offender) => offender.startsWith(`${pendingFile}:`)),
      ).toBe(true);
    },
  );
});

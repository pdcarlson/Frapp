/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every write in this package names its feature (#3393).
 *
 * The shared query-error reporter (`@repo/observability`'s
 * `createQueryErrorReporter`) groups a failed mutation in Sentry by the first
 * element of its `mutationKey`, and one with no key reports as `unkeyed`,
 * which pools every feature's failures into one issue per status class. The
 * root must be identifier-shaped, as the reporter sends nothing else
 * (`KEY_ROOT_RE` there); later elements are never read, but stay ids or fixed
 * words, never text a member typed.
 *
 * A source scan rather than a render of each hook: there are over a hundred,
 * most needing their own client mocks, and the property is a fact about the
 * call site.
 */
const SRC = dirname(fileURLToPath(import.meta.url));
const KEY_ROOT = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
/** A key built by a named constant or helper; its root is checked where it is defined. */
const KEY_EXPRESSION = /^mutationKey:\s*([A-Za-z_$][\w$]*)/;

interface Call {
  file: string;
  line: number;
  options: string;
}

/** The options object of each `useMutation({ … })` call, brace-matched. */
function mutationCalls(): Call[] {
  const calls: Call[] = [];
  const files = readdirSync(SRC).filter(
    (name: string) => /\.tsx?$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name),
  );
  for (const file of files) {
    const source = readFileSync(join(SRC, file), "utf8");
    for (const match of source.matchAll(/\buseMutation\s*(<[^(]*?>)?\s*\(/g)) {
      const open = source.indexOf("{", match.index + match[0].length - 1);
      const between = source.slice(match.index + match[0].length, open);
      const line = source.slice(0, match.index).split("\n").length;
      if (open === -1 || between.trim() !== "") {
        // Options passed as a variable: the scan can't see its key.
        calls.push({ file, line, options: "" });
        continue;
      }
      let depth = 0;
      let end = open;
      for (; end < source.length; end++) {
        if (source[end] === "{") depth++;
        else if (source[end] === "}" && --depth === 0) break;
      }
      calls.push({ file, line, options: source.slice(open + 1, end) });
    }
  }
  return calls;
}

/** The top-level `mutationKey:` property, ignoring nested objects. */
function topLevelKey(options: string): string | null {
  let depth = 0;
  for (let i = 0; i < options.length; i++) {
    const ch = options[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (depth === 0 && options.startsWith("mutationKey", i)) {
      return options.slice(i, options.indexOf("\n", i));
    }
  }
  return null;
}

describe("mutation keys (#3393)", () => {
  const calls = mutationCalls();

  it("finds the package's mutations", () => {
    // A scan that silently matched nothing would pass every check below.
    expect(calls.length).toBeGreaterThan(100);
  });

  it("gives every useMutation a mutationKey with an identifier-shaped root", () => {
    const missing = calls
      .filter(({ options }) => {
        const key = topLevelKey(options);
        if (!key) return true;
        const literal = key.match(/^mutationKey:\s*\[\s*"([^"]*)"/);
        if (literal) return !KEY_ROOT.test(literal[1]!);
        return !KEY_EXPRESSION.test(key);
      })
      .map(({ file, line }) => `${file}:${line}`);
    expect(missing).toEqual([]);
  });
});

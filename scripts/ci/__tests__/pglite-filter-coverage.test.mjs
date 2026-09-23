import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, posix, relative } from "node:path";

import { ALL_REQUIRED_CHECKS } from "../lib/required-checks.mjs";
import { SEED_RELATIVE_PATH } from "../../lib/chapter-directory-seed.mjs";

// `pglite-migrations` is a REQUIRED check (#2538) that is path-gated on PRs by a
// job-level `if:` on `changes.pglite`. A job skipped that way reports Success,
// so a PR that changes a file the check reads, but that the filter misses,
// merges green. The check then first fails on the push to `main`, where
// `validate-deploy-sha.mjs` refuses to deploy that commit and every later one
// until someone fixes it. The first review of #2538 found exactly that gap:
// `apps/api/src/application/services/search.service.ts`, the demo seed's
// `scripts/ci/lib` imports, `.github/environments.json`, the root
// `package.json` and `ci.yml` itself were all unlisted.
//
// So the filter's coverage is derived here from the script, not restated: every
// path its modules name by `join(...)` or `resolve(...)` on `REPO_ROOT` or
// `process.cwd()` (the same directory in the entry), by `new URL(...,
// import.meta.url)`, or by a relative `import`/`export ... from`/`import()`.
// Each path is normalized and routed the same way whatever named it: a
// JavaScript module is followed and scanned in turn, anything else is recorded
// as an input. Each path argument must be a literal, in any quote style; a
// computed one, or a path outside the repo, fails the test rather than being
// skipped, because this derivation cannot resolve it.
//
// The modules are read by a small lexer, not by regexes over raw text, because
// every regex version of this test was fooled by something ordinary: a nested
// call inside an argument, import attributes, a form mentioned in a comment. The
// lexer masks comments and the bodies of strings, template text and regex
// literals (`mask`), so a call's name, brackets and commas are found only in
// code. A source it cannot read to the end (an unterminated string, template,
// regex or comment) fails the test. It is still not a parser: whether a `/`
// starts a regex is decided by the token before it, the usual heuristic, which
// handles postfix `i++ /`, a property named like a keyword and `if (x) /re/`,
// but a misread that closes on the same line would hide the rest of that line
// without failing. This job runs with no `npm ci` (see ci.yml), which is why it
// doesn't import a real parser.
//
// A path read through any other form (a module constant joined onto a local
// root, say) is invisible here. The one such input today, the chapter directory
// seed, is imported from its module below rather than restated.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENTRY = "scripts/check-pglite-migrations.mjs";

// Inputs the job depends on that the forms above cannot derive: the job's own
// definition, the npm script it runs, the lockfile, and the seed CSV that
// `chapter-directory-seed.mjs` reads through its own constant.
const STRUCTURAL = [
  ".github/workflows/ci.yml",
  "package.json",
  "package-lock.json",
  SEED_RELATIVE_PATH.split("\\").join("/"),
];

const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "case", "in", "of", "void", "delete", "throw", "new",
  "yield", "await", "else", "do",
]);

/**
 * `src` with its comments blanked and the bodies of its strings, template text
 * and regex literals replaced by `_`, the same length, newlines kept. Template
 * `${...}` expressions stay, lexed as code. Everything structural below runs
 * on this masked copy, where a bracket, comma, quote or call name can only be
 * code, and reads literal values from `src` at the same offsets. Throws when
 * the source ends inside a string, comment, regex or template.
 */
export function mask(src) {
  const out = src.split("");
  const blank = (from, to, fill) => {
    for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = fill;
  };
  const len = src.length;

  // The previous token in the masked output (a word, or one punctuator) and the
  // index it starts at.
  const previous = (i) => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(out[k])) k -= 1;
    if (k < 0) return { token: "", at: -1 };
    if (!/[\w$]/.test(out[k])) return { token: out[k], at: k };
    let from = k;
    while (from > 0 && /[\w$]/.test(out[from - 1])) from -= 1;
    return { token: out.slice(from, k + 1).join(""), at: from };
  };
  // Indices of each `)` that closes an `if`/`while`/`for`/`with` condition,
  // after which a `/` starts a regex rather than a division.
  const closesControl = new Set();
  const regexCanStart = (i) => {
    const { token, at } = previous(i);
    if (token === "") return true;
    if (token === ")") return closesControl.has(at);
    // `i++ / 2` and `n-- / 2` divide.
    if ((token === "+" || token === "-") && out[at - 1] === token) return false;
    if (/^[(,=:[!&|?{};+\-*%<>~^]$/.test(token)) return true;
    // A keyword, unless it is a property name (`stats.in / n`).
    return REGEX_AFTER_WORD.has(token) && out[at - 1] !== ".";
  };

  const quoted = (i) => {
    for (let j = i + 1; j < len; j += 1) {
      if (src[j] === "\\") j += 1;
      else if (src[j] === src[i]) return j + 1;
      else if (src[j] === "\n") break;
    }
    throw new Error(`unterminated string literal at offset ${i}`);
  };
  const regex = (i) => {
    let inClass = false;
    for (let j = i + 1; j < len; j += 1) {
      const c = src[j];
      if (c === "\\") j += 1;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        let end = j + 1;
        while (/[a-z]/i.test(src[end] ?? "")) end += 1;
        return end;
      } else if (c === "\n") break;
    }
    throw new Error(`unterminated regex literal at offset ${i}`);
  };
  // Returns the index of the matching `}` when `inTemplate`, else `len`.
  const code = (i, inTemplate) => {
    let depth = 0;
    const parens = [];
    while (i < len) {
      const c = src[i];
      const next = src[i + 1];
      if (c === "/" && next === "/") {
        const end = src.indexOf("\n", i) === -1 ? len : src.indexOf("\n", i);
        blank(i, end, " ");
        i = end;
      } else if (c === "/" && next === "*") {
        const close = src.indexOf("*/", i + 2);
        if (close === -1) throw new Error(`unterminated block comment at offset ${i}`);
        blank(i, close + 2, " ");
        i = close + 2;
      } else if (c === '"' || c === "'") {
        const end = quoted(i);
        blank(i + 1, end - 1, "_");
        i = end;
      } else if (c === "`") {
        i = template(i);
      } else if (c === "/" && regexCanStart(i)) {
        const end = regex(i);
        blank(i, end, "_");
        i = end;
      } else {
        if (c === "(") {
          parens.push(["if", "while", "for", "with"].includes(previous(i).token));
        }
        if (c === ")" && parens.pop()) closesControl.add(i);
        if (inTemplate && c === "{") depth += 1;
        if (inTemplate && c === "}") {
          if (depth === 0) return i;
          depth -= 1;
        }
        i += 1;
      }
    }
    if (inTemplate) throw new Error("unterminated template expression");
    return len;
  };
  const template = (i) => {
    let text = i + 1;
    for (let j = i + 1; j < len; j += 1) {
      if (src[j] === "\\") j += 1;
      else if (src[j] === "`") {
        blank(text, j, "_");
        return j + 1;
      } else if (src[j] === "$" && src[j + 1] === "{") {
        blank(text, j, "_");
        j = code(j + 2, true);
        text = j + 1;
      }
    }
    throw new Error(`unterminated template literal at offset ${i}`);
  };

  let start = 0;
  if (src.startsWith("#!")) {
    start = src.indexOf("\n") === -1 ? len : src.indexOf("\n");
    blank(0, start, " ");
  }
  code(start, false);
  return out.join("");
}

/** Index just past the bracket group opening at `i` of masked code. */
function closeOf(masked, i) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  for (let j = i; j < masked.length; j += 1) {
    if (pairs[masked[j]]) stack.push(pairs[masked[j]]);
    else if (masked[j] === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return j + 1;
    }
  }
  throw new Error(`unbalanced "${masked[i]}" at offset ${i}`);
}

/**
 * Each call whose name `opener` matches (a regex ending at its `(`), with its
 * source text and its top-level arguments as trimmed source text.
 */
function callArgs(src, masked, opener) {
  const calls = [];
  for (const match of masked.matchAll(opener)) {
    const open = match.index + match[0].length - 1;
    const close = closeOf(masked, open) - 1;
    const args = [];
    let from = open + 1;
    for (let j = from; j < close; j += 1) {
      if ("([{".includes(masked[j])) j = closeOf(masked, j) - 1;
      else if (masked[j] === ",") {
        args.push(src.slice(from, j).trim());
        from = j + 1;
      }
    }
    const last = src.slice(from, close).trim();
    if (last !== "") args.push(last);
    calls.push({ call: src.slice(match.index, close + 1), args });
  }
  return calls;
}

/** A single `"..."`, `'...'` or interpolation-free template literal's value, else `null`. */
function literal(arg) {
  const m = arg.match(/^(?:"([^"\\]*)"|'([^'\\]*)'|`([^`\\$]*)`)$/);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/**
 * The repo paths one module reads (`found`) and the JavaScript modules it pulls
 * in (`follow`), both repo-relative. `file` is the module's repo-relative path.
 */
export function scan(src, file) {
  const masked = mask(src);
  const moduleUrl = pathToFileURL(join(REPO, file));
  const rel = (url) => relative(REPO, fileURLToPath(url)).split("\\").join("/");
  const found = [];
  const follow = [];
  const unresolved = (call) =>
    `${file}: \`${call}\` names a path this test cannot resolve — ` +
    "write it with literal arguments, or add it to STRUCTURAL";
  // Every form routes through here: follow a JavaScript module, record the rest.
  const route = (path, call) => {
    assert.ok(path !== ".." && !path.startsWith("../"), `${file}: \`${call}\` names a path outside the repo`);
    (/\.[cm]?js$/.test(path) ? follow : found).push(path);
  };

  for (const { call, args } of callArgs(src, masked, /\b(?:join|resolve)\s*\(/g)) {
    const [root, ...rest] = args;
    if (root !== "REPO_ROOT" && root !== "process.cwd()") continue;
    const parts = rest.map(literal);
    assert.ok(parts.length > 0 && parts.every((p) => p !== null), unresolved(call));
    // `resolve` restarts at an absolute segment, which here would leave the repo.
    assert.ok(
      !call.startsWith("resolve") || parts.every((p) => !p.startsWith("/")),
      `${file}: \`${call}\` names a path outside the repo`,
    );
    route(posix.join(...parts), call);
  }

  for (const { call, args } of callArgs(src, masked, /\bnew\s+URL\s*\(/g)) {
    if (args[1] !== "import.meta.url") continue;
    const target = literal(args[0] ?? "");
    assert.ok(target !== null, unresolved(call));
    // WHATWG resolution, so `"x.csv"` is the module's sibling just as
    // `"./x.csv"` is.
    const url = new URL(target, moduleUrl);
    if (url.protocol === "file:") route(rel(url), call);
  }

  // Static forms take only a string literal: find them in the masked code, where
  // a string can't be mistaken for one, and read the specifier from the source
  // at the same offsets. Unanchored, so two on one line both count.
  const staticForms = [
    /\b(?:import|export)\b[^;]*?\bfrom\s*["'](_*)["']/dg,
    /\bimport\s*["'](_*)["']/dg,
  ];
  const specifiers = [
    ...staticForms.flatMap((form) =>
      [...masked.matchAll(form)].map((m) => src.slice(...m.indices[1])),
    ),
    // Dynamic: the first argument is the specifier; a second is its attributes.
    ...callArgs(src, masked, /(?<![.\w$])import\s*\(/g).map(({ call, args }) => {
      const target = literal(args[0] ?? "");
      assert.ok(target !== null, unresolved(call));
      return target;
    }),
  ];
  for (const specifier of specifiers) {
    // ESM resolves only `./`, `../` and `/` as paths; anything else is a package.
    if (/^\.{0,2}\//.test(specifier)) route(rel(new URL(specifier, moduleUrl)), specifier);
  }

  return { found, follow };
}

/** Every repo-relative path the check reads, following JavaScript modules. */
function inputs() {
  const seen = new Set();
  const found = new Set(STRUCTURAL);
  const queue = [ENTRY];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    found.add(file);
    const abs = join(REPO, file);
    assert.ok(existsSync(abs), `${file} is referenced but does not exist`);
    const result = scan(readFileSync(abs, "utf8"), file);
    for (const path of result.found) found.add(path);
    queue.push(...result.follow);
  }
  return [...found];
}

/** The `changes.pglite` filter's patterns, in order. */
function pgliteFilter() {
  const lines = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8").split("\n");
  const start = lines.findIndex((line) => /^\s+pglite:\s*$/.test(line));
  assert.ok(start > 0, "no `pglite:` filter in ci.yml — re-point this test");
  const indent = lines[start].search(/\S/);
  const patterns = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (line.search(/\S/) <= indent) break;
    const m = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/);
    if (m) patterns.push(m[1].trim());
  }
  assert.ok(patterns.length > 0, "the `pglite:` filter parsed empty — the parser broke");
  return patterns;
}

/**
 * dorny/paths-filter semantics for the two forms the filter uses. A directory
 * input (`join(REPO_ROOT, "supabase", "migrations")`) is covered when a file
 * inside it would be.
 */
function covered(path, patterns) {
  const abs = join(REPO, path);
  const probe = existsSync(abs) && statSync(abs).isDirectory() ? `${path}/x` : path;
  return patterns.some((p) =>
    p.endsWith("/**") ? probe.startsWith(p.slice(0, -2)) : probe === p,
  );
}

describe("pglite-migrations: required, and its path filter covers what it reads", () => {
  it("is a required check (#2538)", () => {
    assert.ok(
      ALL_REQUIRED_CHECKS.includes("pglite-migrations"),
      "pglite-migrations was dropped from the required roster",
    );
  });

  it("the derivation finds the inputs the first review found missing", () => {
    // Guards the derivation itself: if a form stops matching, `inputs()`
    // shrinks and the coverage assertion below passes over nothing.
    const found = inputs();
    for (const expected of [
      "apps/api/src/application/services/search.service.ts",
      "supabase/migrations",
      "supabase/seed/chapter_directory.csv",
      "scripts/demo/seed-demo.mjs",
      "scripts/demo/demo-seed.sql",
      "scripts/ci/lib/environments.mjs",
      ".github/environments.json",
      "scripts/load-chapter-directory.mjs",
      "scripts/lib/chapter-directory-seed.mjs",
    ]) {
      assert.ok(found.includes(expected), `derivation no longer finds ${expected}`);
    }
  });

  it("every input is matched by `changes.pglite`", () => {
    const patterns = pgliteFilter();
    const missing = inputs().filter((path) => !covered(path, patterns));
    assert.deepEqual(
      missing,
      [],
      "the pglite job would skip on a PR changing these, then fail on main",
    );
  });
});

describe("the scanner reads each form as what it is", () => {
  // Every case here is one an earlier regex version of this test misread.
  const at = "scripts/ci/lib/example.mjs";

  it("takes any quote style and any number of literal arguments", () => {
    const { found, follow } = scan(
      [
        'readFileSync(join(REPO_ROOT, "apps", \'api\', `x.ts`));',
        'spawn(join(process.cwd(), "scripts", "y.mjs"));',
      ].join("\n"),
      at,
    );
    assert.deepEqual(found, ["apps/api/x.ts"]);
    assert.deepEqual(follow, ["scripts/y.mjs"]);
  });

  it("resolves a bare `new URL` target as the module's sibling", () => {
    const src = 'new URL("seed.csv", import.meta.url); new URL(`../a.json`, import.meta.url);';
    assert.deepEqual(scan(src, at).found, ["scripts/ci/lib/seed.csv", "scripts/ci/a.json"]);
  });

  it("fails on a computed argument, nested calls included", () => {
    for (const src of [
      "new URL(name(), import.meta.url);",
      "new URL(join(\"..\", \"x.sql\"), import.meta.url);",
      "join(REPO_ROOT, dir);",
      "await import(`./${name}.mjs`);",
    ]) {
      assert.throws(() => scan(src, at), /cannot resolve/, src);
    }
  });

  it("reads import attributes as attributes, not as a second path", () => {
    const src = 'const d = await import("./data.json", { with: { type: "json" } });';
    assert.deepEqual(scan(src, at).found, ["scripts/ci/lib/data.json"]);
  });

  it("ignores a form a comment only mentions", () => {
    const src = [
      "// import() and join(REPO_ROOT, x) and new URL(f(), import.meta.url)",
      "/* import(nope) */",
      'const re = /"\\/\\//; const url = "https://x/*";',
    ].join("\n");
    assert.deepEqual(scan(src, at), { found: [], follow: [] });
  });

  it("reads a hashbang, and a regex inside a template, as what they are", () => {
    // Both misread by the first version of this lexer: the hashbang's
    // `/usr/bin` as a regex, and the `'` in `/'/g` as a string's start.
    const src = [
      "#!/usr/bin/env node",
      "const q = (v) => `'${String(v).replace(/'/g, \"''\")}'`;",
      'const s = "join(REPO_ROOT, x)"; import("./y.mjs");',
    ].join("\n");
    assert.deepEqual(scan(src, at), { found: [], follow: ["scripts/ci/lib/y.mjs"] });
  });

  it("finds every static form, two to a line included", () => {
    const src = [
      'import a from "./a.mjs"; import b from "./b.mjs";',
      'foo(); export { d } from "./d.mjs"; export * from "./e.mjs";',
      'import{ c } from "./c.mjs"; import "./f.mjs";',
      'import cfg from "./cfg.json" with { type: "json" };',
    ].join("\n");
    assert.deepEqual(scan(src, at), {
      found: ["scripts/ci/lib/cfg.json"],
      follow: ["a", "b", "d", "e", "c", "f"].map((n) => `scripts/ci/lib/${n}.mjs`),
    });
  });

  it("masks template text and regex bodies, so a call there is not a call", () => {
    // Unmasked, each would be a computed `import`/`join` and throw.
    const src = [
      "const s = `see join(REPO_ROOT, dir) and import(x)`;",
      "const re = /import(x)/;",
    ].join("\n");
    assert.deepEqual(scan(src, at), { found: [], follow: [] });
  });

  it("routes every form by what the path is, not by what named it", () => {
    const src = [
      'readFileSync(join(process.cwd(), "supabase", "seed.sql"));',
      'spawn(fileURLToPath(new URL("./run.mjs", import.meta.url)));',
      'readFileSync(resolve(REPO_ROOT, "apps", "y.ts"));',
      'readFileSync(join(REPO_ROOT, "scripts", "demo", "..", "..", "apps", "z.ts"));',
    ].join("\n");
    assert.deepEqual(scan(src, at), {
      found: ["supabase/seed.sql", "apps/y.ts", "apps/z.ts"],
      follow: ["scripts/ci/lib/run.mjs"],
    });
  });

  it("fails on a path outside the repo", () => {
    for (const src of [
      'join(REPO_ROOT, "..", "x");',
      'resolve(REPO_ROOT, "/etc/passwd");',
      'import "../../../../x.mjs";',
    ]) {
      assert.throws(() => scan(src, at), /outside the repo/, src);
    }
  });

  it("tells a division from a regex after `++`, a property and a condition", () => {
    // Each misread would blank the `join` between the two slashes.
    for (const [src, path] of [
      ['const n = i++ / 2; join(REPO_ROOT, "b.sql"); const q = n / 3;', "b.sql"],
      ['const h = o.return / 2; join(REPO_ROOT, "c.sql"); const k = h / 4;', "c.sql"],
      ['if (ok) /\\/\\//.test(u); join(REPO_ROOT, "d.sql");', "d.sql"],
    ]) {
      assert.deepEqual(scan(src, at).found, [path], src);
    }
  });

  it("fails rather than derive from a source it cannot read to the end", () => {
    for (const [src, error] of [
      ['const s = "unterminated;\nimport("./x.mjs");', /unterminated string/],
      ["const t = `unterminated;", /unterminated template literal/],
      ["const t = `${a;", /unterminated template/],
      ["const r = /unterminated;\nx;", /unterminated regex/],
      ["/* unterminated", /unterminated block comment/],
    ]) {
      assert.throws(() => scan(src, at), error, src);
    }
  });
});

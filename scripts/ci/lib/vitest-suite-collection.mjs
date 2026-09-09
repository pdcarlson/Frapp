import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Shared matcher for the apps/web and apps/landing vitest collection guards
 * (#1788). Those specs read `include` / `exclude` from their own
 * `vitest.config.ts`; this module only interprets those strings.
 *
 * OUT OF SCOPE. `scripts/ci/__tests__/*.test.mjs` MUST stay `.test` — Node's
 * built-in runner has no `.spec` pattern. This helper is not used there.
 */

export const SUITE_NAME = /\.(?:test|spec)\.(?:ts|tsx)$/;

export function readStaticStringArray(source, key, configPath) {
  const match = source.match(new RegExp(`${key}:\\s*\\[([^\\]]*)]`));
  if (!match) {
    throw new Error(
      `${configPath}: could not read \`${key}\` as a static string array. ` +
        `Keep it a literal so the collection guard can follow the config instead of cloning it.`,
    );
  }
  const items = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
  if (items.length === 0) {
    throw new Error(`${configPath}: \`${key}\` is an empty array`);
  }
  return items;
}

function expandBraces(pattern) {
  const match = pattern.match(/\{([^{}]+)\}/);
  if (!match || match.index === undefined) return [pattern];
  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + match[0].length);
  return match[1].split(",").flatMap((option) => expandBraces(`${before}${option}${after}`));
}

function globToRegExp(pattern) {
  let i = 0;
  let out = "^";
  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 3;
      continue;
    }
    if (pattern.startsWith("**", i)) {
      out += ".*";
      i += 2;
      continue;
    }
    const char = pattern[i];
    if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    i += 1;
  }
  out += "$";
  return new RegExp(out);
}

export function matchesGlob(relativePosix, pattern) {
  return expandBraces(pattern).some((expanded) => globToRegExp(expanded).test(relativePosix));
}

export function matchesAny(relativePosix, patterns) {
  return patterns.some((pattern) => matchesGlob(relativePosix, pattern));
}

export function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".next") {
      return [];
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(full);
    return entry.isFile() ? [full] : [];
  });
}

export function relativePosix(root, abs) {
  return relative(root, abs).split(sep).join("/");
}

export function silentlySkippedSuites(relativePosixPaths, include, exclude) {
  return relativePosixPaths
    .filter((file) => SUITE_NAME.test(file))
    .filter((file) => !matchesAny(file, exclude) && !matchesAny(file, include))
    .sort();
}

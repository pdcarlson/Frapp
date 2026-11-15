import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The chat shell is on every dashboard route, so a static import of one of
 * these panels puts it back in the JavaScript every cold open downloads before
 * the first screen (#3716). A type-only import is erased and costs nothing.
 *
 * Specifiers are compared after resolving `./x` to `@/components/chat/x`, so
 * the alias spelling of the same module can't slip past.
 */
const DEFERRED = [
  "./poll-form",
  "./signup-form",
  "./form-builder",
  "./event-quick-form",
  "@/components/tasks/task-form",
  "@/components/service/log-hours-form",
  "@/components/points/points-adjustment-form",
  "@/components/events/event-editor-dialog",
  "@/components/members/member-detail-sheet",
  "./thread-panel",
];

function resolve(specifier: string): string {
  const path = specifier.startsWith("./")
    ? `@/components/chat/${specifier.slice(2)}`
    : specifier;
  return path.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
}

const shell = readFileSync(join(__dirname, "chat-shell.tsx"), "utf8");
const statements = [
  ...shell.matchAll(
    /^(import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["'];/gms,
  ),
].map((m) => ({
  keyword: m[1],
  typeOnly: Boolean(m[2]),
  target: resolve(m[3] ?? ""),
}));

describe("chat shell panels", () => {
  it("finds the shell's import statements at all", () => {
    expect(statements.length).toBeGreaterThan(20);
  });

  it.each(DEFERRED)("never loads %s statically", (path) => {
    const target = resolve(path);
    const loading = statements.filter(
      (s) => s.target === target && (s.keyword === "export" || !s.typeOnly),
    );
    expect(loading).toEqual([]);
  });

  it("lists in the preload every panel it splits", () => {
    const source = readFileSync(join(__dirname, "deferred-panels.tsx"), "utf8");
    for (const path of DEFERRED) {
      expect(source.split(`import("${path}")`).length - 1).toBe(2);
    }
  });
});

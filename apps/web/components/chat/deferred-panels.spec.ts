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
  "./role-picker-form",
  "./form-builder",
  "./event-quick-form",
  "@/components/tasks/task-form",
  "@/components/service/log-hours-form",
  "@/components/points/points-adjustment-form",
  "@/components/events/event-editor-dialog",
  "@/components/members/member-detail-sheet",
  "./thread-panel",
  // Tiptap and ProseMirror (#5050): the composer, and the edit box a message
  // row opens.
  "./composer",
  "./inline-message-editor",
];

/** The modules on every dashboard route that used to load those statically. */
const STATIC_IMPORTERS = [
  "chat-shell.tsx",
  "message-item.tsx",
  "chat-drop-target.tsx",
  "chat-route-skeleton.tsx",
];

function resolve(specifier: string): string {
  const path = specifier.startsWith("./")
    ? `@/components/chat/${specifier.slice(2)}`
    : specifier;
  return path.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
}

const statements = STATIC_IMPORTERS.flatMap((file) => [
  ...readFileSync(join(__dirname, file), "utf8").matchAll(
    /^(import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["'];/gms,
  ),
]).map((m) => ({
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

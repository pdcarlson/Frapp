import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The chat shell is on every dashboard route, so a static import of one of
 * these panels puts it back in the JavaScript every cold open downloads before
 * the first screen (#3716). A type-only import is erased and costs nothing.
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

const shell = readFileSync(join(__dirname, "chat-shell.tsx"), "utf8");

describe("chat shell panels", () => {
  it.each(DEFERRED)("imports %s only through deferred-panels", (path) => {
    const imports = [
      ...shell.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms),
    ].filter((m) => m[2] === path);
    expect(imports.every((m) => m[1])).toBe(true);
  });

  it("lists in the preload every panel it splits", () => {
    const source = readFileSync(join(__dirname, "deferred-panels.tsx"), "utf8");
    for (const path of DEFERRED) {
      expect(source.split(`import("${path}")`).length - 1).toBe(2);
    }
  });
});

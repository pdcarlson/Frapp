import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isRecord, records, str } from "./narrow";

/**
 * The boundary readers every untyped payload goes through (#2100). Three
 * selectors once kept their own `isRecord`, and all three had dropped the
 * `!Array.isArray` guard, so a list read as a row.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe("isRecord", () => {
  it("takes a plain object and nothing else", () => {
    expect(isRecord({ id: "a" })).toBe(true);
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord([{ id: "a" }])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("row")).toBe(false);
    expect(isRecord(0)).toBe(false);
  });

  it("is the app's only definition, so no selector keeps a copy that drifts", () => {
    const copies = ["app", "components", "lib"]
      .flatMap((dir) => sources(join(ROOT, dir)))
      .filter((path) =>
        /\bfunction isRecord\b|\bconst isRecord\b/.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map((path) => relative(ROOT, path));
    expect(copies).toEqual([join("lib", "more", "narrow.ts")]);
  });
});

describe("records", () => {
  it("keeps the rows of a list and drops what isn't one", () => {
    expect(records([{ id: "a" }, ["b"], null, "c", { id: "d" }])).toEqual([
      { id: "a" },
      { id: "d" },
    ]);
    expect(records({ id: "a" })).toEqual([]);
    expect(records(undefined)).toEqual([]);
  });
});

describe("str", () => {
  it("reads a non-blank string, and treats blank as absent", () => {
    expect(str({ name: "Rush" }, "name")).toBe("Rush");
    expect(str({ name: "  " }, "name")).toBeNull();
    expect(str({ name: "" }, "name")).toBeNull();
    expect(str({ name: 3 }, "name")).toBeNull();
    expect(str({}, "name")).toBeNull();
  });
});

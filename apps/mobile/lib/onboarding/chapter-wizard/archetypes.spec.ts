import { describe, expect, it } from "vitest";
import {
  CHAPTER_ARCHETYPE_KEYS,
  CHAPTER_ARCHETYPES,
  resolveArchetypeKey,
} from "./archetypes";

describe("CHAPTER_ARCHETYPES", () => {
  it("covers every key exactly once", () => {
    expect(CHAPTER_ARCHETYPES.map((row) => row.key)).toEqual([
      ...CHAPTER_ARCHETYPE_KEYS,
    ]);
  });
});

describe("resolveArchetypeKey", () => {
  it("keeps a known key", () => {
    expect(resolveArchetypeKey("nphc")).toBe("nphc");
  });

  it("falls back to ifc for unknown or empty values", () => {
    expect(resolveArchetypeKey("not-a-council")).toBe("ifc");
    expect(resolveArchetypeKey(null)).toBe("ifc");
    expect(resolveArchetypeKey("")).toBe("ifc");
  });
});

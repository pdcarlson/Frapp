import { describe, expect, it } from "vitest";
import {
  categoryIdFromSectionKey,
  categorySectionKey,
  isSidebarSectionKey,
  SIDEBAR_FIXED_SECTION_KEYS,
} from "./chat-sidebar";

const ID = "0a000000-0000-4000-8000-000000000001";

describe("sidebar section keys", () => {
  it("accepts every fixed group", () => {
    for (const key of SIDEBAR_FIXED_SECTION_KEYS) {
      expect(isSidebarSectionKey(key)).toBe(true);
    }
  });

  it("accepts a category key and reads its id back", () => {
    const key = categorySectionKey(ID);
    expect(key).toBe(`category:${ID}`);
    expect(isSidebarSectionKey(key)).toBe(true);
    expect(categoryIdFromSectionKey(key)).toBe(ID);
  });

  it("lower-cases the id when building a key", () => {
    expect(categorySectionKey(ID.toUpperCase())).toBe(`category:${ID}`);
  });

  it.each([
    "",
    "Pinned",
    "hidden",
    "category:",
    "category:not-a-uuid",
    `category:${ID.toUpperCase()}`,
    `category:${ID} `,
    ` pinned`,
    ID,
  ])("rejects %j", (key) => {
    expect(isSidebarSectionKey(key)).toBe(false);
  });

  it("reads no category id from a fixed group", () => {
    expect(categoryIdFromSectionKey("channels")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { validatedChapterGroupId, validatedDistinctId } from "./identity";

const HEX = "a".repeat(64);
const UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("validatedDistinctId", () => {
  it("accepts a 64-char lowercase hex digest when analytics is enabled", () => {
    expect(
      validatedDistinctId({ enabled: true, distinct_id: HEX }),
    ).toBe(HEX);
  });

  it("rejects a UUID, an email, and a disabled identity", () => {
    expect(
      validatedDistinctId({ enabled: true, distinct_id: UUID }),
    ).toBeNull();
    expect(
      validatedDistinctId({
        enabled: true,
        distinct_id: "treasurer@chapter.example.edu",
      }),
    ).toBeNull();
    expect(
      validatedDistinctId({ enabled: false, distinct_id: HEX }),
    ).toBeNull();
    expect(validatedDistinctId(null)).toBeNull();
  });
});

describe("validatedChapterGroupId", () => {
  it("accepts hex and rejects a raw chapter id", () => {
    expect(validatedChapterGroupId({ chapter_group_id: HEX })).toBe(HEX);
    expect(validatedChapterGroupId({ chapter_group_id: UUID })).toBeNull();
    expect(validatedChapterGroupId({ chapter_group_id: null })).toBeNull();
  });
});

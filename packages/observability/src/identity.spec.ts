import { describe, expect, it } from "vitest";
import {
  fetchAnalyticsIdentity,
  isObservabilityIdentitySubjectReady,
  observabilityIdentityQueryKey,
  observabilityIdentityQueryOptions,
  validatedChapterGroupId,
  validatedDistinctId,
} from "./identity";

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

describe("fetchAnalyticsIdentity", () => {
  it("returns the body and throws on error", async () => {
    await expect(
      fetchAnalyticsIdentity(async () => ({
        data: { enabled: true, distinct_id: HEX, chapter_group_id: null },
      })),
    ).resolves.toEqual({
      enabled: true,
      distinct_id: HEX,
      chapter_group_id: null,
    });
    await expect(
      fetchAnalyticsIdentity(async () => ({ error: new Error("nope") })),
    ).rejects.toThrow("nope");
    await expect(fetchAnalyticsIdentity(async () => ({}))).resolves.toBeNull();
  });
});

describe("observabilityIdentityQueryKey / options", () => {
  it("keys the query on auth subject then chapter, or none", () => {
    expect(observabilityIdentityQueryKey("user-1", "chap-1")).toEqual([
      "observability-identity",
      "user-1",
      "chap-1",
    ]);
    expect(observabilityIdentityQueryKey(null, null)).toEqual([
      "observability-identity",
      "none",
      "none",
    ]);
  });

  it("disables the query when the app says so", () => {
    const options = observabilityIdentityQueryOptions(
      "user-1",
      "chap-1",
      async () => ({}),
      false,
    );
    expect(options.enabled).toBe(false);
    expect(options.retry).toBe(false);
    expect(options.queryKey).toEqual([
      "observability-identity",
      "user-1",
      "chap-1",
    ]);
  });

  it("does not fetch under a missing subject even when the app asks to", () => {
    for (const subject of [null, "", "none"] as const) {
      const options = observabilityIdentityQueryOptions(
        subject,
        "chap-1",
        async () => ({}),
        true,
      );
      expect(isObservabilityIdentitySubjectReady(subject)).toBe(false);
      expect(options.enabled).toBe(false);
      expect(options.queryKey).toEqual([
        "observability-identity",
        subject ?? "none",
        "chap-1",
      ]);
    }
  });
});

import { describe, expect, it } from "vitest";
import { isDiscordImportClearable } from "./discord-import";

describe("isDiscordImportClearable", () => {
  it("clears only a deleted import", () => {
    expect(isDiscordImportClearable("purged")).toBe(true);
  });

  it.each([
    "draft",
    "ready",
    "running",
    "completed",
    "failed",
    "cancelled",
    "purging",
  ])("keeps a %s import listed, since it may still need deleting", (status) => {
    expect(isDiscordImportClearable(status)).toBe(false);
  });
});

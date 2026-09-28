import { describe, expect, it } from "vitest";
import {
  DISCORD_IMPORT_POLL_MS,
  discordImportListPollMs,
} from "./use-discord-import";

describe("discordImportListPollMs", () => {
  it("polls the list while an import on it is being deleted, so Clear appears without a reload", () => {
    expect(
      discordImportListPollMs([{ status: "completed" }, { status: "purging" }]),
    ).toBe(DISCORD_IMPORT_POLL_MS);
  });

  it("does not poll otherwise; the detail poll follows the watched import", () => {
    expect(
      discordImportListPollMs([{ status: "running" }, { status: "purged" }]),
    ).toBe(false);
    expect(discordImportListPollMs([])).toBe(false);
    expect(discordImportListPollMs(undefined)).toBe(false);
  });
});

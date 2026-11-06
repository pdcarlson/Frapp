import { describe, expect, it } from "vitest";
import {
  DISCORD_IMPORT_POLL_MS,
  discordImportListPollMs,
} from "./use-discord-import";

describe("discordImportListPollMs", () => {
  it.each(["ready", "running", "purging"])(
    "polls the list while an import on it is %s",
    (status) => {
      expect(discordImportListPollMs([{ status: "purged" }, { status }])).toBe(
        DISCORD_IMPORT_POLL_MS,
      );
    },
  );

  it("does not poll once nothing on it moves", () => {
    expect(
      discordImportListPollMs([{ status: "completed" }, { status: "purged" }]),
    ).toBe(false);
    expect(discordImportListPollMs([])).toBe(false);
    expect(discordImportListPollMs(undefined)).toBe(false);
  });
});

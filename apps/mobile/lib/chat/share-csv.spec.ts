import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shareCsv } from "./share-csv";

/**
 * The phone's Export (#3926 step 4): rows become the dashboard's CSV, written
 * to the cache under the dashboard's file name, and handed to the share
 * sheet. A failure anywhere comes back as `false` for the card to report.
 */
const fs = vi.mocked(FileSystem);
const sharing = vi.mocked(Sharing);

beforeEach(() => {
  vi.clearAllMocks();
  sharing.isAvailableAsync.mockResolvedValue(true);
  fs.writeAsStringAsync.mockResolvedValue(undefined);
  sharing.shareAsync.mockResolvedValue(undefined);
});

describe("shareCsv", () => {
  it("writes the CSV into the cache and shares it as a CSV", async () => {
    const ok = await shareCsv(
      [{ Name: "Alex", Answer: "=1+1" }],
      "form-room-picks",
      "Export responses",
    );
    expect(ok).toBe(true);
    // The folder is new on every export, and neither platform's write makes
    // a missing parent, so it has to exist before the write.
    expect(fs.makeDirectoryAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/\/cache\/chat-export\/\d+\/$/),
      { intermediates: true },
    );
    expect(fs.makeDirectoryAsync.mock.invocationCallOrder[0]).toBeLessThan(
      fs.writeAsStringAsync.mock.invocationCallOrder[0]!,
    );
    const [uri, text] = fs.writeAsStringAsync.mock.calls[0]!;
    expect(uri).toMatch(
      /^file:\/\/\/cache\/chat-export\/\d+\/frapp-form-room-picks-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(text).toBe("﻿Name,Answer\r\nAlex,'=1+1");
    expect(sharing.shareAsync).toHaveBeenCalledWith(uri, {
      dialogTitle: "Export responses",
      mimeType: "text/csv",
      UTI: "public.comma-separated-values-text",
    });
  });

  it("shares nothing when there are no rows", async () => {
    expect(await shareCsv([], "signup", "Export")).toBe(false);
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it("is false when sharing isn't available or the write fails", async () => {
    sharing.isAvailableAsync.mockResolvedValueOnce(false);
    expect(await shareCsv([{ A: "1" }], "signup", "Export")).toBe(false);
    fs.writeAsStringAsync.mockRejectedValueOnce(new Error("disk full"));
    expect(await shareCsv([{ A: "1" }], "signup", "Export")).toBe(false);
    expect(sharing.shareAsync).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { groupWarnings } from "./import-warnings";

describe("groupWarnings", () => {
  it("groups by reason, names the file, and keeps Other last", () => {
    const groups = groupWarnings([
      'Storage couldn\'t take "IMG_1.png", so it was not imported. The message it belongs to was.',
      '"notes.tar.gz" is a file type Frapp doesn\'t store (application/gzip) and was not imported. The message it belongs to was.',
      "Uploaded export part is missing: part-003.json",
      '"budget.xlsm" is a file type the archive does not accept (application/vnd.ms-excel.sheet.macroenabled.12) and was not imported. The message it belongs to was.',
      '"scan" has no file type Frapp could tell, so it was not imported. The message it belongs to was.',
    ]);

    expect(groups.map((group) => [group.title, group.items])).toEqual([
      ["File types Frapp doesn't store", ["notes.tar.gz", "budget.xlsm"]],
      ["Files with no type Frapp could tell", ["scan"]],
      ["Files storage couldn't take", ["IMG_1.png"]],
      ["Export files Frapp couldn't read", ["part-003.json"]],
    ]);
  });

  it("groups an older raw storage error by its file, never showing the raw text", () => {
    const [group] = groupWarnings([
      'Could not import attachment "p1.png": <html><body>502 Bad Gateway</body></html>',
    ]);
    expect(group).toEqual({
      key: "storage",
      title: "Files storage couldn't take",
      items: ["p1.png"],
    });
  });

  it("names the channel a skipped channel warning is about", () => {
    const [group] = groupWarnings([
      "#old-memes is no longer readable in Discord (deleted, or the bot lost access). It was skipped.",
    ]);
    expect(group?.items).toEqual(["#old-memes"]);
  });

  // Every reason the API writes, in its current and older wording: the
  // patterns are copied from the worker's sentences, so a drift shows here.
  it.each([
    [
      '"huge.mov" is larger than the archive accepts and was not imported. The message it belongs to was.',
      "Files too large to store",
      "huge.mov",
    ],
    [
      '"old.png" is no longer available from Discord, so it was not imported. The message it belongs to was.',
      "Files Discord no longer has",
      "old.png",
    ],
    [
      'Attachment "old.png" is no longer available from Discord and was not imported.',
      "Files Discord no longer has",
      "old.png",
    ],
    [
      '"media/a.png" wasn\'t in the upload, so it was not imported. The message it belongs to was.',
      "Files missing from the upload",
      "media/a.png",
    ],
    [
      "No uploaded file for attachment: media/a.png",
      "Files missing from the upload",
      "media/a.png",
    ],
    [
      'Export file "part-2.json" couldn\'t be read (Not valid JSON: Unexpected token), so its messages were skipped.',
      "Export files Frapp couldn't read",
      "part-2.json",
    ],
    [
      "part-2.json: Not valid JSON: Unexpected token",
      "Export files Frapp couldn't read",
      "part-2.json",
    ],
    [
      'Export file "part-9.json" is 120 MB, over the 100 MB limit for one export file, so its messages were skipped. Re-export with a smaller --partition.',
      "Export files Frapp couldn't read",
      "part-9.json",
    ],
    [
      "#rush had no place chosen in Frapp, so its messages were skipped.",
      "Channels with no place chosen",
      "#rush",
    ],
    [
      "No mapping for #rush; its messages were skipped.",
      "Channels with no place chosen",
      "#rush",
    ],
    [
      "A message with no id or time in the export was skipped.",
      "Messages with no id or time",
      "A message with no id or time in the export was skipped.",
    ],
  ])("groups %s", (warning, title, item) => {
    const [group] = groupWarnings([warning]);
    expect(group?.title).toBe(title);
    expect(group?.items).toEqual([item]);
  });

  it("cuts an unmatched warning to a readable length", () => {
    const [group] = groupWarnings(["x".repeat(400)]);
    expect(group?.items[0]).toHaveLength(160);
    expect(group?.items[0]?.endsWith("…")).toBe(true);
  });
});

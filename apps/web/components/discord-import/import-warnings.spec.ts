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
      ["Other", ["Uploaded export part is missing: part-003.json"]],
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

  it("cuts an unmatched warning to a readable length", () => {
    const [group] = groupWarnings(["x".repeat(400)]);
    expect(group?.items[0]).toHaveLength(160);
    expect(group?.items[0]?.endsWith("…")).toBe(true);
  });
});

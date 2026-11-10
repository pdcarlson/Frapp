import { describe, expect, it } from "vitest";
import { filesFromClipboard } from "./clipboard-files";

type Item = { kind: string; getAsFile: () => File | null };

const clipboard = ({
  text = "",
  files = [] as File[],
  items = [] as Item[],
} = {}) =>
  ({
    getData: (type: string) => (type === "text/plain" ? text : ""),
    files,
    items,
  }) as unknown as DataTransfer;

const png = (name: string) => new File(["png"], name, { type: "image/png" });
const at = new Date(2026, 10, 10, 9, 5, 7);

describe("filesFromClipboard (#2246)", () => {
  it("returns nothing for no clipboard or an empty one", () => {
    expect(filesFromClipboard(null)).toEqual([]);
    expect(filesFromClipboard(clipboard())).toEqual([]);
  });

  it("returns nothing when the clipboard carries text, files or not", () => {
    expect(filesFromClipboard(clipboard({ text: "hi" }))).toEqual([]);
    expect(
      filesFromClipboard(clipboard({ text: "A1\tB1", files: [png("x.png")] })),
    ).toEqual([]);
  });

  it("treats whitespace-only text as no text", () => {
    const files = filesFromClipboard(
      clipboard({ text: " \n", files: [png("chart.png")] }),
    );
    expect(files.map((file) => file.name)).toEqual(["chart.png"]);
  });

  it("names a screenshot the browser called image.png by when it was pasted", () => {
    const [file] = filesFromClipboard(
      clipboard({ files: [png("image.png")] }),
      at,
    );
    expect(file?.name).toBe("Pasted image 2026-11-10 at 09.05.07.png");
    expect(file?.type).toBe("image/png");
  });

  it("numbers several unnamed images pasted at once, and keeps real names", () => {
    const files = filesFromClipboard(
      clipboard({
        files: [
          png("image.png"),
          png("diagram.png"),
          new File(["jpg"], "", { type: "image/jpeg" }),
        ],
      }),
      at,
    );
    expect(files.map((file) => file.name)).toEqual([
      "Pasted image 2026-11-10 at 09.05.07 (1).png",
      "diagram.png",
      "Pasted image 2026-11-10 at 09.05.07 (2).jpg",
    ]);
  });

  it("falls back to file items when the browser leaves files empty", () => {
    const files = filesFromClipboard(
      clipboard({
        items: [
          { kind: "string", getAsFile: () => null },
          { kind: "file", getAsFile: () => png("photo.png") },
        ],
      }),
    );
    expect(files.map((file) => file.name)).toEqual(["photo.png"]);
  });
});

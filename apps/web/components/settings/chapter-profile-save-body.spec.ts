import { describe, expect, it } from "vitest";
import { chapterProfileSaveBody } from "./chapter-profile-save-body";

const STORED = {
  name: "Phi Gamma Delta Tau Nu",
  university: "RPI",
  donation_url: "https://give.rpi.edu/fiji",
};

describe("chapterProfileSaveBody", () => {
  it("sends nothing when nothing changed, spaces aside", () => {
    expect(
      chapterProfileSaveBody(STORED, { ...STORED, name: ` ${STORED.name} ` }),
    ).toEqual({});
  });

  // A name stored before the 3-character minimum, such as "XY", must not
  // refuse an officer's edit of the donation link.
  it("sends only the donation link when only it changed", () => {
    const stored = { ...STORED, name: "XY" };
    expect(
      chapterProfileSaveBody(stored, {
        ...stored,
        donation_url: "https://give.rpi.edu/fiji-2027",
      }),
    ).toEqual({ donation_url: "https://give.rpi.edu/fiji-2027" });
  });

  it("sends a changed name and university trimmed", () => {
    expect(
      chapterProfileSaveBody(STORED, {
        ...STORED,
        name: " Tau Nu ",
        university: "Rensselaer ",
      }),
    ).toEqual({ name: "Tau Nu", university: "Rensselaer" });
  });

  it("sends a cleared name, so the API says what it needs", () => {
    expect(chapterProfileSaveBody(STORED, { ...STORED, name: "  " })).toEqual({
      name: "",
    });
  });

  it("leaves out a cleared donation link, which the API can't clear", () => {
    expect(
      chapterProfileSaveBody(STORED, { ...STORED, donation_url: "" }),
    ).toEqual({});
  });
});

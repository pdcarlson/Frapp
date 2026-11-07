import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_TYPES,
  documentTypeOptions,
  guessDocumentType,
  suggestFolder,
  titleFromFilename,
} from "./upload-defaults";

describe("titleFromFilename", () => {
  it.each([
    ["fall-2026-bylaws-revision.pdf", "Fall 2026 bylaws revision"],
    ["IFC_Risk_Policy.docx", "IFC Risk Policy"],
    ["exec minutes 10-12.pdf", "Exec minutes 10-12"],
    ["scan_0042.pdf", "Scan 0042"],
    ["README", "README"],
    [".pdf", ".pdf"],
  ])("%s reads %s", (name, title) => {
    expect(titleFromFilename(name)).toBe(title);
  });
});

describe("guessDocumentType", () => {
  const options = [...DEFAULT_DOCUMENT_TYPES];

  it("matches whole words only", () => {
    expect(guessDocumentType("exec-minutes.pdf", options)).toBe("Minutes");
    expect(guessDocumentType("formal-dinner.pdf", options)).toBeNull();
    expect(guessDocumentType("uniform-order.pdf", options)).toBeNull();
  });

  it("returns the chapter's own spelling of a type", () => {
    expect(guessDocumentType("bylaws.pdf", ["BYLAWS", "Minutes"])).toBe("BYLAWS");
  });

  it("matches a chapter's own type named in the file", () => {
    expect(
      guessDocumentType("Rush schedule.pdf", [...options, "Schedule"]),
    ).toBe("Schedule");
  });
});

describe("documentTypeOptions", () => {
  it("lists defaults then the chapter's types, once each", () => {
    expect(documentTypeOptions(["bylaws", "Contract", null, " ", "contract"])).toEqual([
      "bylaws",
      "Minutes",
      "Agenda",
      "Budget",
      "Policy",
      "Form",
      "contract",
    ]);
  });
});

describe("suggestFolder", () => {
  const folders = ["Meeting Minutes", "Bylaws & Governance", "Finance", "Recruitment"];

  it("prefers where the chapter already files that type", () => {
    expect(
      suggestFolder("Minutes", folders, [
        { document_type: "minutes", folder: "Recruitment" },
        { document_type: "Minutes", folder: "Recruitment" },
        { document_type: "Minutes", folder: "Meeting Minutes" },
      ]),
    ).toBe("Recruitment");
  });

  it("falls back to a folder whose name says the type", () => {
    expect(suggestFolder("Bylaws", folders, [])).toBe("Bylaws & Governance");
    expect(suggestFolder("Minutes", folders, [])).toBe("Meeting Minutes");
    expect(suggestFolder("Budget", folders, [])).toBe("Finance");
    expect(suggestFolder("Form", folders, [])).toBeNull();
  });
});

describe("type spellings", () => {
  it("treats By-Laws and bylaws as one type and returns the chapter's spelling", () => {
    const options = documentTypeOptions(["By-Laws"]);
    expect(options.filter((o) => /by-?laws/i.test(o))).toEqual(["By-Laws"]);
    expect(guessDocumentType("bylaws-2026.pdf", options)).toBe("By-Laws");
  });
});

import { describe, expect, it } from "vitest";
import { EMPTY_FIELDS } from "./fields";
import {
  clearStagedBulkUpload,
  documentFields,
  stageBulkUpload,
  takeStagedBulkUpload,
} from "./handoff";

describe("bulk upload hand-off", () => {
  const pdf = new File(["%PDF"], "smithj_midterm.pdf", { type: "application/pdf" });

  it("gives the staged files to one taker only", () => {
    stageBulkUpload({ files: [pdf], skipped: 0 });
    expect(takeStagedBulkUpload()?.files).toEqual([pdf]);
    expect(takeStagedBulkUpload()).toBeNull();
  });

  it("keeps only the latest staging, and clears on request", () => {
    const other = new File(["%PDF"], "b.pdf", { type: "application/pdf" });
    stageBulkUpload({ files: [pdf], skipped: 0 });
    stageBulkUpload({ files: [other], skipped: 2 });
    expect(takeStagedBulkUpload()).toEqual({ files: [other], skipped: 2 });
    stageBulkUpload({ files: [pdf], skipped: 0 });
    clearStagedBulkUpload();
    expect(takeStagedBulkUpload()).toBeNull();
  });

  it("fills a staged file's form with its own fields over the batch's, title included (#3509)", () => {
    const file = new File(["%PDF"], "smithj_12345.pdf", { type: "application/pdf" });
    stageBulkUpload({
      files: [file],
      skipped: 0,
      fields: {
        ...EMPTY_FIELDS,
        title: "CS 2120 Midterm",
        course_number: "2120",
        assignment_number: "2",
        document_variant: "Student Copy",
      },
    });
    const sticky = { ...EMPTY_FIELDS, course_number: "1100", document_variant: "Blank Copy" };
    expect(documentFields(sticky, file)).toMatchObject({
      title: "CS 2120 Midterm",
      course_number: "2120",
      assignment_number: "2",
      document_variant: "Student Copy",
    });
  });

  it("falls back to the filename title, and to the batch's fields, for anything else", () => {
    const blankTitle = new File(["%PDF"], "midterm_2.pdf", { type: "application/pdf" });
    stageBulkUpload({ files: [blankTitle], skipped: 0, fields: { ...EMPTY_FIELDS, title: " " } });
    expect(documentFields(EMPTY_FIELDS, blankTitle).title).toBe("midterm 2");

    const dropped = new File(["%PDF"], "quiz.pdf", { type: "application/pdf" });
    const sticky = { ...EMPTY_FIELDS, course_number: "1100" };
    expect(documentFields(sticky, dropped)).toMatchObject({ title: "quiz", course_number: "1100" });
  });
});

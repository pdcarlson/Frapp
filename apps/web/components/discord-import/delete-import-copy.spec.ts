import { describe, expect, it } from "vitest";
import { deleteImportConfirmation, purgeLine } from "./delete-import-copy";
import type { ImportRow } from "./import-progress";

const row = (overrides: Partial<ImportRow>): ImportRow => ({
  id: "i1",
  status: "completed",
  guild_name: "Tau Nu Discord",
  total_messages: 0,
  imported_messages: 0,
  messages_skipped: 0,
  attachments_imported: 0,
  warnings: [],
  error: null,
  created_at: "2026-09-28T18:06:33Z",
  ...overrides,
});

describe("deleteImportConfirmation (#2944)", () => {
  it("is destructive, and names its action rather than confirming", () => {
    const request = deleteImportConfirmation(row({ imported_messages: 3 }));
    expect(request.tone).toBe("destructive");
    expect(request.confirmLabel).toBe("Delete import");
    expect(request.cancelLabel).toBeUndefined();
  });

  it("counts in the singular, and leaves out attachments it has none of", () => {
    expect(
      deleteImportConfirmation(row({ imported_messages: 1 })).description,
    ).toMatch(
      /^This deletes the 1 message it brought in, and its archive files\./,
    );
    expect(
      deleteImportConfirmation(
        row({ imported_messages: 2, attachments_imported: 1 }),
      ).description,
    ).toMatch(/^This deletes the 2 messages and 1 attachment it brought in/);
  });

  it("names only the archive files for an import that brought in nothing", () => {
    const { description } = deleteImportConfirmation(row({}));
    expect(description).toMatch(/^This deletes its archive files\./);
    expect(description).toMatch(/This cannot be undone\.$/);
  });

  it("asks about this Discord import when the server has no name", () => {
    expect(deleteImportConfirmation(row({ guild_name: null })).title).toBe(
      "Delete this Discord import?",
    );
  });
});

describe("purgeLine (#2944)", () => {
  it("is null for an import that is not deleting or deleted", () => {
    expect(purgeLine(row({ status: "completed" }))).toBeNull();
    expect(purgeLine(row({ status: "running" }))).toBeNull();
  });

  it("says a deleted import is deleted, whatever its count says", () => {
    // Deleted before the count existed, so it reads 0.
    expect(purgeLine(row({ status: "purged", imported_messages: 50 }))).toBe(
      "Deleted. The messages, attachments and archive files it brought in are gone.",
    );
  });

  it("says what is left, then what it is doing once no message is", () => {
    expect(
      purgeLine(
        row({ status: "purging", imported_messages: 2, purged_messages: 1 }),
      ),
    ).toBe("Deleting: 1 of 2 messages left");
    expect(purgeLine(row({ status: "purging" }))).toBe(
      "Messages deleted. Removing the channels it emptied and its archive files.",
    );
  });
});

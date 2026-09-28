import { describe, expect, it } from "vitest";
import { importPercent, type ImportRow } from "./import-progress";

const row = (overrides: Partial<ImportRow>): ImportRow => ({
  id: "i1",
  status: "running",
  guild_name: null,
  total_messages: 0,
  imported_messages: 0,
  messages_skipped: 0,
  attachments_imported: 0,
  warnings: [],
  error: null,
  created_at: "2026-09-28T18:06:33Z",
  ...overrides,
});

describe("importPercent", () => {
  it("measures a running bot import in channel rows, not its ever-growing message total (#2816)", () => {
    // Staging, 2026-09-28: 5,307 of 5,307 messages read, 201 of 900 rows done.
    expect(
      importPercent(
        row({
          source: "bot",
          total_messages: 5307,
          imported_messages: 5307,
          channels_total: 900,
          channels_done: 201,
        }),
      ),
    ).toBe(22);
  });

  it("keeps 100% for an import that has finished", () => {
    expect(
      importPercent(
        row({
          status: "running",
          channels_total: 900,
          channels_done: 900,
        }),
      ),
    ).toBe(99);
    expect(
      importPercent(
        row({ status: "completed", channels_total: 900, channels_done: 900 }),
      ),
    ).toBe(100);
  });

  it("measures an upload in messages, as before", () => {
    expect(
      importPercent(row({ total_messages: 400, imported_messages: 100 })),
    ).toBe(25);
    expect(importPercent(row({ total_messages: 0 }))).toBe(0);
  });
});

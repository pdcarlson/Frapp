import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharedConfig from "@repo/theme/tailwind";
import { describe, expect, it, vi, beforeEach } from "vitest";
const { writeXlsxFileSpy } = vi.hoisted(() => ({
  writeXlsxFileSpy: vi.fn(() => ({ toBlob: async () => new Blob(["xlsx"]) })),
}));
vi.mock("write-excel-file/browser", () => ({ default: writeXlsxFileSpy }));

import {
  cn,
  downloadBlob,
  downloadCsv,
  downloadXlsx,
  exportRows,
  getErrorMessage,
  guardDecimalDraft,
  guardIntDraft,
  labelled,
  parseGuardedDecimal,
  parseGuardedInt,
  readLastExportFormat,
  rememberExportFormat,
  rowsToCsv,
  rowsToTsv,
  rowsToXlsxData,
} from "./utils";

describe("labelled", () => {
  it("puts the label before a formatted value", () => {
    expect(labelled("Due", "Fri, Nov 6")).toBe("Due Fri, Nov 6");
  });

  it("drops out when the value didn't format, rather than printing null", () => {
    expect(labelled("Due", null)).toBeNull();
  });
});

/**
 * Dashboard toasts use this helper, which goes through the shared error map
 * (`@repo/hooks` `errorCopy`, specced there): a refusal the map knows reads in
 * the member's words, anything else falls back, and no raw server text or
 * `Error` message reaches the toast (principles.md P2.3).
 */
describe("getErrorMessage", () => {
  const fallback = "Something went wrong. Please retry.";

  it("rewrites a known refusal on a plain object (openapi-fetch body)", () => {
    expect(
      getErrorMessage(
        {
          message: "Role name already exists in this chapter",
          statusCode: 409,
        },
        fallback,
      ),
    ).toBe("A role with that name already exists. Pick another name.");
  });

  it("never shows an unmapped server sentence or a plain Error's message", () => {
    expect(
      getErrorMessage(
        { message: "Forbidden resource", statusCode: 500 },
        fallback,
      ),
    ).toBe(fallback);
    expect(getErrorMessage(new Error("network down"), fallback)).toBe(fallback);
  });

  it("uses the caller fallback when message is missing, empty, or not a string", () => {
    expect(getErrorMessage(null, fallback)).toBe(fallback);
    expect(getErrorMessage(undefined, fallback)).toBe(fallback);
    expect(getErrorMessage("nope", fallback)).toBe(fallback);
    expect(getErrorMessage({}, fallback)).toBe(fallback);
    expect(getErrorMessage({ message: "" }, fallback)).toBe(fallback);
    expect(
      getErrorMessage(
        { message: ["lat must be a number", "lng too"] },
        fallback,
      ),
    ).toBe(fallback);
  });
});

describe("downloadBlob", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  it("creates an object URL, clicks a download anchor, and revokes it", () => {
    const blob = new Blob(["content"], { type: "text/plain" });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    downloadBlob(blob, "report.csv");

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download="report.csv"]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    clickSpy.mockRestore();
  });

  // The reviewer finding this regression-locks: an unguarded click that
  // throws must still remove the anchor and revoke the object URL, or both
  // leak on every failed download.
  it("still removes the anchor and revokes the object URL when click() throws", () => {
    const blob = new Blob(["content"], { type: "text/plain" });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {
        throw new Error("blocked by extension");
      });

    expect(() => downloadBlob(blob, "report.csv")).toThrow(
      "blocked by extension",
    );

    expect(document.querySelector('a[download="report.csv"]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    clickSpy.mockRestore();
  });
});

describe("downloadCsv", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  it("names the download frapp-<prefix>-<date>.csv", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toMatch(
          /^frapp-invoices-\d{4}-\d{2}-\d{2}\.csv$/,
        );
        expect(this.download).not.toMatch(/^signet-/);
      });

    downloadCsv([{ amount: "10" }], "invoices");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});

/**
 * The guards `apps/web`'s numeric inputs go through (#2206). A
 * `type="number"` input reports text it can't parse as `""`, but these take
 * the raw text anyway, so a field that isn't `type="number"` is covered too.
 */
describe("parseGuardedInt", () => {
  it.each([
    ["", undefined],
    ["   ", undefined],
    ["abc", undefined],
    ["-3", undefined],
    ["1.5", undefined],
    ["1e999", undefined],
    ["NaN", undefined],
    // Past 2^53 an integer can't be held exactly: this one reads as ...992.
    ["9007199254740993", undefined],
    ["0", 0],
    [" 42 ", 42],
  ])("reads %j as %j", (raw, expected) => {
    expect(parseGuardedInt(raw)).toBe(expected);
  });

  it("refuses an integer under the floor it is given", () => {
    expect(parseGuardedInt("0", 1)).toBeUndefined();
    expect(parseGuardedInt("1", 1)).toBe(1);
  });
});

describe("parseGuardedDecimal", () => {
  it.each([
    ["", undefined],
    ["abc", undefined],
    ["-0.5", undefined],
    ["1e999", undefined],
    ["1e300", undefined],
    ["1.5", 1.5],
    [".5", 0.5],
    ["2", 2],
  ])("reads %j as %j", (raw, expected) => {
    expect(parseGuardedDecimal(raw)).toBe(expected);
  });
});

describe("guardIntDraft", () => {
  it("keeps a cleared field cleared, rather than reading it as 0", () => {
    expect(guardIntDraft("")).toBe("");
    expect(guardIntDraft("  ")).toBe("");
  });

  it.each(["abc", "-3", "1.5", "1e999"])(
    "refuses %j, so the caller keeps its previous draft",
    (raw) => {
      expect(guardIntDraft(raw)).toBeUndefined();
    },
  );

  it("commits an accepted integer as its trimmed text", () => {
    expect(guardIntDraft(" 12 ")).toBe("12");
  });

  // Deleting the 3 of "30" leaves "0" on the way to "45": a field's own floor
  // is checked at submit, not mid-edit.
  it("keeps a transient 0", () => {
    expect(guardIntDraft("0")).toBe("0");
  });
});

describe("guardDecimalDraft", () => {
  it("keeps a decimal and a cleared field, and refuses a negative", () => {
    expect(guardDecimalDraft("1.5")).toBe("1.5");
    expect(guardDecimalDraft("")).toBe("");
    expect(guardDecimalDraft("-1")).toBeUndefined();
  });
});

/**
 * #2842: tailwind-merge filed every Signet type key under text colour, so a
 * key and a colour in one `cn()` call dropped whichever came first.
 */
describe("cn with the Signet type scale", () => {
  const presetKeys = Object.keys(sharedConfig.theme?.extend?.fontSize ?? {});

  it("registers every type key the shared preset binds", () => {
    // `cn` reads its list from the §7 roles in `signet.ts`; the preset is
    // what actually emits the utilities. A key added to one and not the
    // other is a utility `cn` would silently mis-merge.
    expect(presetKeys.length).toBeGreaterThan(0);
    for (const key of presetKeys) {
      expect(cn("text-muted-foreground", `text-${key}`)).toBe(
        `text-muted-foreground text-${key}`,
      );
      expect(cn(`text-${key}`, "text-primary")).toBe(
        `text-${key} text-primary`,
      );
    }
  });

  it("lets a later size replace an earlier one, as with any size", () => {
    expect(cn("text-sm text-muted-foreground", "text-caption")).toBe(
      "text-muted-foreground text-caption",
    );
    expect(cn("text-caption", "text-[11px]")).toBe("text-[11px]");
  });

  it("keeps the crest's code label at caption size beside its tone", () => {
    expect(
      cn(
        "font-mono text-caption font-semibold tracking-[0.1em]",
        "text-primary",
      ),
    ).toContain("text-caption");
  });
});

describe("rowsToCsv", () => {
  it("quotes commas, quotes and line breaks, and keeps emoji", () => {
    const csv = rowsToCsv([
      { Description: 'Said "hi", twice\nthen left 🎉', Amount: "-5" },
    ]);
    expect(csv).toBe(
      '\uFEFFDescription,Amount\r\n"Said ""hi"", twice\nthen left 🎉",-5',
    );
  });

  it("makes a formula-shaped cell inert, header included", () => {
    const csv = rowsToCsv([{ "=cmd": "=1+1", Note: "@here, now" }]);
    expect(csv).toBe("\uFEFF'=cmd,Note\r\n'=1+1,\"'@here, now\"");
  });
});

describe("rowsToTsv", () => {
  it("separates cells with tabs and rows with newlines, with no BOM", () => {
    expect(
      rowsToTsv([
        { Amount: "12", Description: "Founders Day, check-in 🎉" },
        { Amount: "-5", Description: 'Said "late"' },
      ]),
    ).toBe(
      'Amount\tDescription\n12\tFounders Day, check-in 🎉\n-5\t"Said ""late"""',
    );
  });

  it("quotes a cell that leads with a double quote, so a paste cannot swallow the next cell", () => {
    expect(rowsToTsv([{ Note: '"unclosed', Amount: "5" }])).toBe(
      'Note\tAmount\n"""unclosed"\t5',
    );
  });

  it("flattens tabs and line breaks inside a cell, and makes formulas inert", () => {
    expect(rowsToTsv([{ Note: "one\ttwo\r\nthree", Formula: "=1+1" }])).toBe(
      "Note\tFormula\none two three\t'=1+1",
    );
    // Neutralized before flattening: a leading tab must not hide the formula.
    expect(rowsToTsv([{ Note: "\t=1+1" }])).toBe("Note\n' =1+1");
  });

  it("is empty for no rows", () => {
    expect(rowsToTsv([])).toBe("");
  });
});

describe("rowsToXlsxData", () => {
  it("types a column as numbers, currency, dates or timestamps when every cell is one", () => {
    const [header, first, second] = rowsToXlsxData([
      {
        Amount: "12",
        Paid: "$1,234.50",
        Due: "2026-08-01",
        Time: "2026-08-01T12:00:00Z",
      },
      { Amount: "-5", Paid: "-$5.00", Due: "", Time: "2026-08-02T12:00:00+00:00" },
    ]);
    expect(header!.map((cell) => cell?.value)).toEqual([
      "Amount",
      "Paid",
      "Due",
      "Time",
    ]);
    expect(first).toEqual([
      { value: 12, type: Number },
      { value: 1234.5, type: Number, format: "$#,##0.00" },
      { value: new Date("2026-08-01"), type: Date, format: "yyyy-mm-dd" },
      {
        value: new Date("2026-08-01T12:00:00Z"),
        type: Date,
        format: "yyyy-mm-dd hh:mm:ss",
      },
    ]);
    expect(second![0]).toEqual({ value: -5, type: Number });
    expect(second![1]).toMatchObject({ value: -5 });
    // An empty cell stays empty rather than becoming a zero or an epoch date.
    expect(second![2]).toBeNull();
  });

  it("keeps a mixed column, a leading-zero id and a formula as text", () => {
    const [, first, second] = rowsToXlsxData([
      { Mixed: "12", Zip: "02139", Note: "=1+1" },
      { Mixed: "n/a", Zip: "10001", Note: "plain" },
    ]);
    expect(first).toEqual([
      { value: "12", type: String },
      { value: "02139", type: String },
      { value: "=1+1", type: String },
    ]);
    expect(second![1]).toEqual({ value: "10001", type: String });
  });
});

describe("downloadXlsx", () => {
  it("writes a bold, frozen header row and names the file frapp-<prefix>-<date>.xlsx", async () => {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toMatch(/^frapp-points-\d{4}-\d{2}-\d{2}\.xlsx$/);
      });

    await downloadXlsx([{ Amount: "12" }], "points");

    expect(writeXlsxFileSpy).toHaveBeenCalledWith(
      [
        [{ value: "Amount", type: String, fontWeight: "bold" }],
        [{ value: 12, type: Number }],
      ],
      // Sized to the longest value, so a date column never opens as ########.
      { stickyRowsCount: 1, columns: [{ width: 8 }] },
    );
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});

describe("exportRows", () => {
  it("downloads a .csv for CSV and an .xlsx for Excel", async () => {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });
    writeXlsxFileSpy.mockClear();

    await exportRows([{ Amount: "12" }], "points", "csv");
    expect(writeXlsxFileSpy).not.toHaveBeenCalled();
    await exportRows([{ Amount: "12" }], "points", "xlsx");
    expect(writeXlsxFileSpy).toHaveBeenCalledTimes(1);

    expect(names.map((name) => name.split(".").pop())).toEqual(["csv", "xlsx"]);
    clickSpy.mockRestore();
  });

  it("loads the workbook writer on demand, never with the module", () => {
    // `lib/utils.ts` is imported by nearly every component (`cn`), so a static
    // import here would put the writer in every page's first load.
    const source = readFileSync(join(process.cwd(), "lib/utils.ts"), "utf8");
    expect(source).toMatch(/await import\("write-excel-file\/browser"\)/);
    expect(source).not.toMatch(/^import .*write-excel-file/m);
  });

  it("copies tab-separated rows to the clipboard for Google Sheets", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await exportRows([{ Amount: "12", Note: "hi" }], "points", "sheets");

    expect(writeText).toHaveBeenCalledWith("Amount\tNote\n12\thi");
  });

  it("rejects when the clipboard is refused, so the menu can say so", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
      configurable: true,
    });

    await expect(
      exportRows([{ Amount: "12" }], "points", "sheets"),
    ).rejects.toThrow("denied");
  });
});

describe("the remembered export format", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is null until one is used, then the last one used", () => {
    expect(readLastExportFormat()).toBeNull();
    rememberExportFormat("xlsx");
    expect(readLastExportFormat()).toBe("xlsx");
  });

  it("ignores a stored value that is not a format", () => {
    window.localStorage.setItem("frapp.export-format", "pdf");
    expect(readLastExportFormat()).toBeNull();
  });
});

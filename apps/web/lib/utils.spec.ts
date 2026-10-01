import sharedConfig from "@repo/theme/tailwind";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  cn,
  downloadBlob,
  downloadCsv,
  getErrorMessage,
  guardDecimalDraft,
  guardIntDraft,
  parseGuardedDecimal,
  parseGuardedInt,
} from "./utils";

/**
 * Dashboard toasts use this helper so openapi-fetch's thrown body (a plain
 * object with `message`, not an `Error`) surfaces the server string. Five
 * local copies used `instanceof Error` and always showed the fallback; this
 * spec is the regression lock for that shape.
 */
describe("getErrorMessage", () => {
  const fallback = "Something went wrong. Please retry.";

  it("reads a string message on a plain object (openapi-fetch body)", () => {
    expect(
      getErrorMessage({ message: "Role is already assigned.", statusCode: 409 }, fallback),
    ).toBe("Role is already assigned.");
  });

  it("still reads Error instances", () => {
    expect(getErrorMessage(new Error("network down"), fallback)).toBe("network down");
  });

  it("uses the caller fallback when message is missing, empty, or not a string", () => {
    expect(getErrorMessage(null, fallback)).toBe(fallback);
    expect(getErrorMessage(undefined, fallback)).toBe(fallback);
    expect(getErrorMessage("nope", fallback)).toBe(fallback);
    expect(getErrorMessage({}, fallback)).toBe(fallback);
    expect(getErrorMessage({ message: "" }, fallback)).toBe(fallback);
    expect(
      getErrorMessage({ message: ["lat must be a number", "lng too"] }, fallback),
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

    expect(() => downloadBlob(blob, "report.csv")).toThrow("blocked by extension");

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
        expect(this.download).toMatch(/^frapp-invoices-\d{4}-\d{2}-\d{2}\.csv$/);
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
      expect(cn(`text-${key}`, "text-primary")).toBe(`text-${key} text-primary`);
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
      cn("font-mono text-caption font-semibold tracking-[0.1em]", "text-primary"),
    ).toContain("text-caption");
  });
});

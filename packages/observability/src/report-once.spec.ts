import { describe, expect, it, vi } from "vitest";
import { createReportOnce } from "./report-once";

describe("createReportOnce", () => {
  it("reports an error object once, with the context of its first report", () => {
    const capture = vi.fn();
    const report = createReportOnce<{ boundary: string }>(capture);
    const error = new Error("render");

    report(error, { boundary: "screen" });
    report(error, { boundary: "root" });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(error, { boundary: "screen" });
  });

  it("reports two error objects separately, even with the same message", () => {
    const capture = vi.fn();
    const report = createReportOnce<null>(capture);

    report(new Error("same"), null);
    report(new Error("same"), null);

    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("reports a thrown non-object every time", () => {
    const capture = vi.fn();
    const report = createReportOnce<null>(capture);

    for (const thrown of ["boom", "boom", undefined, null, 7]) report(thrown, null);

    expect(capture).toHaveBeenCalledTimes(5);
  });

  it("keeps one set per reporter, so two reporters don't hide each other's reports", () => {
    const first = vi.fn();
    const second = vi.fn();
    const error = new Error("shared");

    createReportOnce<null>(first)(error, null);
    createReportOnce<null>(second)(error, null);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

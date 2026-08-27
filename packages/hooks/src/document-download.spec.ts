import { describe, expect, it } from "vitest";
import { selectDownloadUrl } from "./document-download";

// #1040: web read `download_url` at two call sites and opened `undefined`,
// because `ChapterDocumentService.findById` returns `downloadUrl` and
// nothing in the stack transforms case. The endpoint has no OpenAPI response
// schema, so the SDK types the body as `never` and any property access
// type-checks — a test is the only thing that can catch the wrong spelling.
describe("selectDownloadUrl", () => {
  it("reads the camelCase key the API actually returns", () => {
    expect(
      selectDownloadUrl({ id: "d-1", downloadUrl: "https://signed/url" }),
    ).toBe("https://signed/url");
  });

  it("still accepts snake_case, so a server rename cannot break a client", () => {
    expect(selectDownloadUrl({ download_url: "https://signed/url" })).toBe(
      "https://signed/url",
    );
  });

  it("prefers the camelCase key when a payload somehow carries both", () => {
    expect(
      selectDownloadUrl({
        downloadUrl: "https://correct/url",
        download_url: "https://legacy/url",
      }),
    ).toBe("https://correct/url");
  });

  it("returns null rather than a falsy string for an absent or empty url", () => {
    expect(selectDownloadUrl({ id: "d-1" })).toBeNull();
    expect(selectDownloadUrl({ downloadUrl: "" })).toBeNull();
    expect(selectDownloadUrl({ downloadUrl: 42 })).toBeNull();
  });

  // Blank-is-absent, matching the `str` helper this was lifted from. A
  // whitespace-only URL must reach the caller's `if (!url) throw` and show the
  // error toast, not open a blank tab.
  it("treats a whitespace-only url as absent", () => {
    expect(selectDownloadUrl({ downloadUrl: "   " })).toBeNull();
    expect(selectDownloadUrl({ downloadUrl: "\n\t" })).toBeNull();
  });

  // A blank camelCase value must not shadow a usable snake_case one.
  it("falls through to snake_case when the camelCase value is blank", () => {
    expect(
      selectDownloadUrl({ downloadUrl: "   ", download_url: "https://signed/url" }),
    ).toBe("https://signed/url");
  });

  it("returns null for a non-object, so a failed fetch cannot throw here", () => {
    expect(selectDownloadUrl(undefined)).toBeNull();
    expect(selectDownloadUrl(null)).toBeNull();
    expect(selectDownloadUrl("https://not/a/document")).toBeNull();
  });
});

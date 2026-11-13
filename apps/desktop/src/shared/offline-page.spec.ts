import { signetDarkTokens } from "@repo/theme/signet";
import { describe, expect, it } from "vitest";
import { offlinePageHtml, WINDOW_BACKGROUND } from "./offline-page";

describe("offlinePageHtml", () => {
  it("retries the app's own address", () => {
    expect(offlinePageHtml("https://app.frapp.live")).toContain('const target = "https://app.frapp.live";');
  });

  it("can't be broken out of by the address", () => {
    const html = offlinePageHtml('https://app.frapp.live/"</script><script>alert(1)</script>');
    expect(html).not.toContain("</script><script>alert(1)");
  });

  it("uses Signet's background, so the window doesn't flash a different black", () => {
    expect(WINDOW_BACKGROUND).toBe(signetDarkTokens.color.surface.background);
  });
});

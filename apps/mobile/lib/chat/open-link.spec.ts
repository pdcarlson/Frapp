import { Alert } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LINK_OPEN_FAILED_BODY,
  LINK_OPEN_FAILED_TITLE,
  openMessageLink,
} from "./open-link";

beforeEach(() => {
  vi.mocked(Alert.alert).mockClear();
  vi.mocked(Linking.openURL).mockClear();
  vi.mocked(WebBrowser.openBrowserAsync).mockClear();
});

describe("openMessageLink", () => {
  it("opens a web page in the in-app browser", async () => {
    await openMessageLink("https://frapp.live/a");
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      "https://frapp.live/a",
    );
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("hands a mailto link to the OS", async () => {
    await openMessageLink("mailto:rush@frapp.live");
    expect(Linking.openURL).toHaveBeenCalledWith("mailto:rush@frapp.live");
  });

  it("refuses anything that is not an openable link", async () => {
    for (const href of [
      "javascript:alert(1)",
      "//attacker.example",
      "x.test",
    ]) {
      await openMessageLink(href);
    }
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("says so when the link won't open, rather than doing nothing", async () => {
    vi.mocked(WebBrowser.openBrowserAsync).mockRejectedValueOnce(
      new Error("no browser"),
    );
    await openMessageLink("https://frapp.live/a");
    expect(Alert.alert).toHaveBeenCalledWith(
      LINK_OPEN_FAILED_TITLE,
      LINK_OPEN_FAILED_BODY,
    );
  });
});

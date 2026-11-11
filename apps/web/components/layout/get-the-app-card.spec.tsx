import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const device = vi.hoisted(() => ({
  phone: null as "ios" | "android" | null,
}));
vi.mock("@/lib/use-phone-platform", () => ({
  usePhonePlatform: () => device.phone,
}));

import { GET_THE_APP_TITLE, GetTheAppCard } from "./get-the-app-card";
import {
  GET_THE_APP_DISMISSED_STORAGE_KEY,
  resetGetTheAppForTests,
} from "@/lib/get-the-app";

beforeEach(() => {
  window.localStorage.clear();
  resetGetTheAppForTests();
  device.phone = null;
});
afterEach(() => vi.restoreAllMocks());

describe("Get the app card (#4002)", () => {
  it("offers the App Store and the app on an iPhone", () => {
    device.phone = "ios";
    render(<GetTheAppCard />);

    expect(
      screen.getByRole("region", { name: GET_THE_APP_TITLE }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Get the app" }).getAttribute("href"),
    ).toBe("https://apps.apple.com/app/id6812025642");
    expect(
      screen.getByRole("link", { name: "Open the app" }).getAttribute("href"),
    ).toBe("frapp://");
  });

  it("offers Google Play on an Android phone", () => {
    device.phone = "android";
    render(<GetTheAppCard />);

    expect(
      screen.getByRole("link", { name: "Get the app" }).getAttribute("href"),
    ).toBe("https://play.google.com/store/apps/details?id=live.frapp.mobile");
  });

  it("shows nothing on a desktop or tablet", () => {
    render(<GetTheAppCard />);
    expect(screen.queryByText(GET_THE_APP_TITLE)).toBeNull();
  });

  it("stays dismissed: gone at once, and on the next page load", () => {
    device.phone = "ios";
    const first = render(<GetTheAppCard />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Dismiss the Get the app suggestion",
      }),
    );
    expect(screen.queryByText(GET_THE_APP_TITLE)).toBeNull();
    expect(window.localStorage.getItem(GET_THE_APP_DISMISSED_STORAGE_KEY)).toBe(
      "1",
    );
    first.unmount();

    resetGetTheAppForTests();
    render(<GetTheAppCard />);
    expect(screen.queryByText(GET_THE_APP_TITLE)).toBeNull();
  });

  it("still hides when storage is blocked, for the rest of the page load", () => {
    device.phone = "ios";
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<GetTheAppCard />);
    expect(screen.getByText(GET_THE_APP_TITLE)).toBeTruthy();
    act(() => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Dismiss the Get the app suggestion",
        }),
      );
    });
    expect(screen.queryByText(GET_THE_APP_TITLE)).toBeNull();
  });

  it("stays out of the app's own in-app browser for the session (?from=app)", () => {
    device.phone = "ios";
    window.history.replaceState(null, "", "/geofences?from=app");
    try {
      const first = render(<GetTheAppCard />);
      expect(screen.queryByText(GET_THE_APP_TITLE)).toBeNull();
      first.unmount();
      // The next page in that browser has no mark, and still shows nothing.
      window.history.replaceState(null, "", "/chat");
      render(<GetTheAppCard />);
      expect(screen.queryByText(GET_THE_APP_TITLE)).toBeNull();
    } finally {
      window.sessionStorage.clear();
      window.history.replaceState(null, "", "/");
    }
  });
});

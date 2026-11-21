import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PRODUCTION_NATIVE_APP } from "@repo/validation";

/**
 * #5626. Web `/join` on a phone: tapping Get copies the invite, so the app's
 * first screen can paste it after the install.
 */

const h = vi.hoisted(() => ({
  installUrl: "https://testflight.apple.com/join/abc123" as string | null,
}));

vi.mock("@/lib/app-install", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-install")>()),
  useAppInstall: () => ({
    app: PRODUCTION_NATIVE_APP,
    installUrl: h.installUrl,
  }),
}));

import { AppHandoff } from "./app-handoff";

const INVITE_ID = "6f1c2a9e-3b4d-4c8e-9a7b-1d2e3f4a5b6c";

function renderHandoff() {
  return render(
    <AppHandoff platform="ios" token={INVITE_ID} />,
  );
}

describe("AppHandoff — the invite survives the install (#5626)", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    h.installUrl = "https://testflight.apple.com/join/abc123";
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("copies the invite link as Get is tapped, and says to paste it in the app", async () => {
    renderHandoff();
    expect(
      screen.getByText("Tapping Get Frapp copies your invite for the app."),
    ).toBeTruthy();

    const get = screen.getByRole("link", { name: "Get Frapp" });
    // The store opens beside this page, which stays to come back to.
    expect(get.getAttribute("target")).toBe("_blank");
    expect(get.getAttribute("href")).toBe(
      "https://testflight.apple.com/join/abc123",
    );
    fireEvent.click(get);

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join?token=${INVITE_ID}`,
    );
    await waitFor(() =>
      expect(
        screen.getByText("Invite copied. When Frapp opens, tap Paste."),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Paste your invite")).toBeTruthy();
    expect(
      screen.getByText(
        "Open Frapp and tap Paste. Already had the app? Open it from here.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Frapp" })).toBeTruthy();
  });

  it("says to come back here when the browser won't copy", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    renderHandoff();
    fireEvent.click(screen.getByRole("link", { name: "Get Frapp" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Couldn't copy your invite. Once Frapp is installed, come back here and tap Open in Frapp.",
        ),
      ).toBeTruthy(),
    );
  });

  it("says the same when there is no clipboard at all", async () => {
    Reflect.deleteProperty(navigator, "clipboard");
    renderHandoff();
    fireEvent.click(screen.getByRole("link", { name: "Get Frapp" }));
    await waitFor(() =>
      expect(screen.getByText(/Couldn't copy your invite/)).toBeTruthy(),
    );
  });

  it("offers Open in the app alone, copying nothing, without an install link", () => {
    h.installUrl = null;
    renderHandoff();
    expect(screen.queryByRole("link", { name: "Get Frapp" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open in Frapp" })).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
  });
});

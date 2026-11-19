import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settingHighlightTarget, useSettingJump } from "./use-setting-jump";

const params = vi.hoisted(() => ({ current: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => params.current,
}));

function Page() {
  useSettingJump();
  return (
    <div>
      <div data-testid="field">
        <label htmlFor="chapter-donation">Donation link</label>
        <input id="chapter-donation" />
      </div>
    </div>
  );
}

describe("useSettingJump", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    window.history.replaceState(
      null,
      "",
      "/settings?tab=org&setting=donation-link",
    );
    params.current = new URLSearchParams("tab=org&setting=donation-link");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scrolls to the field, focuses it, lights its block, and drops the param", async () => {
    const { getByTestId, getByRole } = render(<Page />);
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    const field = getByTestId("field");
    expect(field.scrollIntoView).toHaveBeenCalled();
    expect(field).toHaveClass("setting-flash");
    expect(getByRole("textbox")).toHaveFocus();
    expect(window.location.search).toBe("?tab=org");
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(field).not.toHaveClass("setting-flash");
  });

  it("drops a param it has no anchor for", async () => {
    window.history.replaceState(null, "", "/settings?tab=org&setting=nope");
    params.current = new URLSearchParams("tab=org&setting=nope");
    render(<Page />);
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(window.location.search).toBe("?tab=org");
  });
});

describe("settingHighlightTarget", () => {
  it("lights a marked block over the anchor", () => {
    document.body.innerHTML =
      '<div data-setting-highlight id="block"><section id="a"></section></div>';
    expect(settingHighlightTarget(document.getElementById("a")!).id).toBe(
      "block",
    );
  });
});

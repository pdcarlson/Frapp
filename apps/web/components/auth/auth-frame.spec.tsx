import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import AuthLayout from "@/app/(auth)/layout";
import { AuthFrame } from "./auth-frame";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockWideScreen() {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

describe("AuthFrame", () => {
  it("is what the (auth) layout mounts, so the panel survives a hop between its routes", () => {
    mockWideScreen();
    const { container } = render(
      <AuthLayout>
        <p>form</p>
      </AuthLayout>,
    );
    expect(container.querySelector("main")?.textContent).toContain("form");
    expect(container.querySelector("aside[aria-hidden='true']")).not.toBeNull();
  });

  it("hides the product panel below lg, so the column alone is the phone page", () => {
    mockWideScreen();
    const { container } = render(
      <AuthFrame>
        <p>form</p>
      </AuthFrame>,
    );
    const panel = container.querySelector("aside")!;
    expect(panel.classList).toContain("hidden");
    expect(panel.classList).toContain("lg:block");
    // The form's <h1> is the page's only heading; the frame adds none.
    expect(container.querySelectorAll("h1, h2")).toHaveLength(0);
  });
});

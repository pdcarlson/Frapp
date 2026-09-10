import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OAuthButtons } from "./oauth-buttons";
import { GOOGLE_MARK_COLORS } from "./oauth-brand-icons";

describe("OAuthButtons", () => {
  it("renders Apple and Google as equal secondary actions", () => {
    render(<OAuthButtons onSelect={vi.fn()} />);
    const apple = screen.getByRole("button", { name: "Continue with Apple" });
    const google = screen.getByRole("button", { name: "Continue with Google" });
    expect(apple.className).toMatch(/\bw-full\b/);
    expect(google.className).toMatch(/\bw-full\b/);
    expect(apple.className).toBe(google.className);
    expect(
      apple.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("draws official Apple and Google marks hidden from the accessible name", () => {
    render(<OAuthButtons onSelect={vi.fn()} />);
    const apple = screen.getByRole("button", { name: "Continue with Apple" });
    const google = screen.getByRole("button", { name: "Continue with Google" });
    const appleSvg = apple.querySelector("svg");
    const googleSvg = google.querySelector("svg");
    expect(appleSvg?.getAttribute("aria-hidden")).toBe("true");
    expect(googleSvg?.getAttribute("aria-hidden")).toBe("true");
    expect(appleSvg?.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
    const fills = [...googleSvg!.querySelectorAll("path")].map((path) =>
      path.getAttribute("fill"),
    );
    expect(fills).toEqual([
      GOOGLE_MARK_COLORS.red,
      GOOGLE_MARK_COLORS.blue,
      GOOGLE_MARK_COLORS.yellow,
      GOOGLE_MARK_COLORS.green,
    ]);
  });

  it("notifies the chosen provider", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<OAuthButtons onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(onSelect).toHaveBeenCalledWith("google");
  });

  it("disables both methods while one is pending", () => {
    render(<OAuthButtons onSelect={vi.fn()} pending="apple" />);
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OAuthButtons } from "./oauth-buttons";

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

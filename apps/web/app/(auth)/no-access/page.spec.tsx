import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/auth/no-access-sign-out", () => ({
  NoAccessSignOut: () => null,
}));

import NoAccessPage from "./page";

describe("/no-access", () => {
  it("opens the invite form unmarked, so /join never skips this member back to /chat (#3850)", () => {
    render(<NoAccessPage />);
    // A member here has no access, so /chat would return them to this page.
    // `/join?from=sign-in` skips to /chat; this link must not carry it.
    expect(
      screen.getByRole("link", { name: "Open invite link" }).getAttribute("href"),
    ).toBe("/join");
  });
});

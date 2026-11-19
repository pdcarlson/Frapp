import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { searchSettings } from "@repo/hooks/settings-search";
import { SettingsSearch } from "./settings-search";

vi.mock("@/lib/settings/use-settings-search", () => ({
  useSettingsSearch: () => (query: string) =>
    searchSettings(query, {
      permissions: ["*"],
      platform: "web",
      aiAvailable: true,
      isModuleEnabled: () => true,
    }),
}));

describe("SettingsSearch", () => {
  it("lists settings by a synonym, each linking to its field", async () => {
    const user = userEvent.setup();
    render(<SettingsSearch />);
    await user.type(screen.getByRole("combobox"), "donate");
    const first = screen.getAllByRole("option")[0]!;
    expect(first).toHaveTextContent("Donation link");
    expect(first).toHaveAttribute(
      "href",
      "/settings?tab=org&setting=donation-link",
    );
    expect(first).toHaveAttribute("aria-selected", "true");
  });

  it("moves the highlight with the arrows and clears on Escape", async () => {
    const user = userEvent.setup();
    render(<SettingsSearch />);
    const field = screen.getByRole("combobox");
    await user.type(field, "goal");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(field).toHaveAttribute(
      "aria-activedescendant",
      screen.getAllByRole("option")[1]!.id,
    );
    await user.keyboard("{Escape}");
    expect(field).toHaveValue("");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<SettingsSearch />);
    await user.type(screen.getByRole("combobox"), "zebra");
    expect(
      screen.getAllByText("No settings match. Try another word.").length,
    ).toBeGreaterThan(0);
  });
});

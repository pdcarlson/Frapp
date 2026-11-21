import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsMemberNames } from "./settings-member-names";

describe("SettingsMemberNames (#5801)", () => {
  it("flips the switch for an officer who manages chapter settings", async () => {
    const onChange = vi.fn();
    render(
      <SettingsMemberNames
        enabled={false}
        canManage
        isSaving={false}
        onChange={onChange}
      />,
    );
    const toggle = screen.getByRole("switch", {
      name: "Members can change their own name",
    });
    expect(toggle).not.toBeChecked();
    expect(
      screen.getByText("When off, officers who manage roles change names."),
    ).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("is read-only for a role that can't change it", () => {
    render(
      <SettingsMemberNames
        enabled
        canManage={false}
        isSaving={false}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("switch", { name: "Members can change their own name" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Your role can't change this."),
    ).toBeInTheDocument();
  });
});

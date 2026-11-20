import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsGroup, SettingsRow } from "./settings-row";

describe("SettingsRow", () => {
  it("flips its switch from the label and describes it", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <SettingsGroup label="Privacy">
        <SettingsRow
          label="Read receipts"
          description="Others see when you've read their messages."
          checked={false}
          onCheckedChange={onCheckedChange}
        />
      </SettingsGroup>,
    );
    const toggle = screen.getByRole("switch", { name: "Read receipts" });
    expect(toggle).toHaveAccessibleDescription(
      "Others see when you've read their messages.",
    );
    await user.click(screen.getByText("Read receipts"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("opens a picker from a value row", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <SettingsGroup>
        <SettingsRow label="Theme" value="Dark" onClick={onClick} />
      </SettingsGroup>,
    );
    await user.click(screen.getByRole("button", { name: /Theme/ }));
    expect(onClick).toHaveBeenCalled();
  });
});

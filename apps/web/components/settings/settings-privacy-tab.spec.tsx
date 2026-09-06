import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsPrivacyTab } from "./settings-privacy-tab";

const SWITCH = { name: /chapter analytics enabled/i };

describe("SettingsPrivacyTab", () => {
  it("shows analytics as enabled when the chapter has not opted out", () => {
    render(
      <SettingsPrivacyTab
        analyticsOptOut={false}
        canManage
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("switch", SWITCH)).toBeChecked();
  });

  it("shows analytics as off when the chapter has opted out", () => {
    render(
      <SettingsPrivacyTab
        analyticsOptOut
        canManage
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("switch", SWITCH)).not.toBeChecked();
  });

  it("toggling an enabled chapter off calls onToggle(true) (opt out)", () => {
    const onToggle = vi.fn();
    render(
      <SettingsPrivacyTab
        analyticsOptOut={false}
        canManage
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("switch", SWITCH));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("toggling an opted-out chapter on calls onToggle(false) (opt back in)", () => {
    const onToggle = vi.fn();
    render(
      <SettingsPrivacyTab
        analyticsOptOut
        canManage
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("switch", SWITCH));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("disables the switch when the caller cannot manage config", () => {
    render(
      <SettingsPrivacyTab
        analyticsOptOut={false}
        canManage={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("switch", SWITCH)).toBeDisabled();
  });
});

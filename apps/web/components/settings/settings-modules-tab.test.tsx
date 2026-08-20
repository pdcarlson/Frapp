import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsModulesTab } from "./settings-modules-tab";

describe("SettingsModulesTab", () => {
  it("locks always-on (free) modules and shows a Free badge, no switch", () => {
    render(
      <SettingsModulesTab
        enabledModules={{}}
        canManage
        onToggle={() => {}}
      />,
    );
    // chat / members / announcements / audit-log / chapter-settings are free.
    expect(screen.getAllByText("Free").length).toBe(5);
    // Each locked row renders an "Always on" indicator (plus the group title).
    expect(screen.getAllByText("Always on").length).toBeGreaterThanOrEqual(5);
    expect(
      screen.queryByRole("switch", { name: /chat enabled/i }),
    ).not.toBeInTheDocument();
  });

  it("renders paid modules with a Chapter Pro badge and a switch", () => {
    render(
      <SettingsModulesTab
        enabledModules={{}}
        canManage
        onToggle={() => {}}
      />,
    );
    expect(screen.getAllByText("Chapter Pro").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("switch", { name: /events enabled/i }),
    ).toBeInTheDocument();
  });

  it("treats a module absent from enabled_modules as enabled (!== false)", () => {
    render(
      <SettingsModulesTab
        enabledModules={{}}
        canManage
        onToggle={() => {}}
      />,
    );
    expect(
      screen.getByRole("switch", { name: /events enabled/i }),
    ).toBeChecked();
  });

  it("toggling an enabled paid module off calls onToggle(key, false)", () => {
    const onToggle = vi.fn();
    render(
      <SettingsModulesTab
        enabledModules={{ events: true }}
        canManage
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /events enabled/i }));
    expect(onToggle).toHaveBeenCalledWith("events", false);
  });

  it("reflects an explicitly disabled module as off", () => {
    render(
      <SettingsModulesTab
        enabledModules={{ events: false }}
        canManage
        onToggle={() => {}}
      />,
    );
    expect(
      screen.getByRole("switch", { name: /events enabled/i }),
    ).not.toBeChecked();
  });

  it("disables the switches when the caller cannot manage", () => {
    render(
      <SettingsModulesTab
        enabledModules={{}}
        canManage={false}
        onToggle={() => {}}
      />,
    );
    expect(
      screen.getByRole("switch", { name: /events enabled/i }),
    ).toBeDisabled();
  });

  it("disables only the switch whose module key is currently saving", () => {
    render(
      <SettingsModulesTab
        enabledModules={{}}
        canManage
        onToggle={() => {}}
        pendingModuleKeys={new Set(["enabled_modules.events"])}
      />,
    );
    expect(
      screen.getByRole("switch", { name: /events enabled/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: /tasks enabled/i }),
    ).toBeEnabled();
  });
});

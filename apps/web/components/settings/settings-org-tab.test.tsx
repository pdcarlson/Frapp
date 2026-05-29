import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsOrgTab } from "./settings-org-tab";

const baseProps = {
  vocabulary: {} as Record<string, string>,
  branding: {},
  profile: { name: "Test Chapter", university: "State U", donation_url: "" },
  canManage: true,
  onSaveProfile: () => {},
  onPatchConfig: () => {},
};

describe("SettingsOrgTab", () => {
  it("falls back to the IFC archetype for an unknown key (no crash)", () => {
    render(<SettingsOrgTab archetypeKey="bogus-key" {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /IFC Fraternity/i }),
    ).toHaveTextContent("Current");
  });

  it("shows archetype-appropriate vocabulary placeholders (IFC vs NPHC)", () => {
    const { rerender } = render(
      <SettingsOrgTab archetypeKey="ifc" {...baseProps} />,
    );
    expect(screen.getByPlaceholderText("Rush")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Pledge class")).toBeInTheDocument();

    rerender(<SettingsOrgTab archetypeKey="nphc" {...baseProps} />);
    expect(screen.getByPlaceholderText("Intake")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Line")).toBeInTheDocument();
  });

  it("confirming an archetype switch patches org_archetype + resets vocab and modules", () => {
    const onPatchConfig = vi.fn();
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        onPatchConfig={onPatchConfig}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /NPHC/i }));
    fireEvent.click(screen.getByRole("button", { name: /switch archetype/i }));

    expect(onPatchConfig).toHaveBeenCalledTimes(1);
    const diff = onPatchConfig.mock.calls[0]![0] as {
      org_archetype: string;
      vocabulary: Record<string, string>;
      enabled_modules: Record<string, boolean>;
    };
    expect(diff.org_archetype).toBe("nphc");
    expect(diff.vocabulary).toMatchObject({ recruitment: "Intake", class: "Line" });
    // NPHC seeds points off by default — proves modules reset to the new archetype.
    expect(diff.enabled_modules.chat).toBe(true);
    expect(diff.enabled_modules.points).toBe(false);
  });

  it("saves the chapter profile through onSaveProfile", () => {
    const onSaveProfile = vi.fn();
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        onSaveProfile={onSaveProfile}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    expect(onSaveProfile).toHaveBeenCalledWith({
      name: "Test Chapter",
      university: "State U",
      donation_url: "",
    });
  });

  it("patches branding through onPatchConfig when identity is saved", () => {
    const onPatchConfig = vi.fn();
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        branding={{ greek_letters: "ΣΦΕ", designation: "Cal Eta" }}
        onPatchConfig={onPatchConfig}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save identity/i }));
    expect(onPatchConfig).toHaveBeenCalledWith({
      branding: { greek_letters: "ΣΦΕ", designation: "Cal Eta" },
    });
  });

  it("disables save controls when the caller cannot manage", () => {
    render(
      <SettingsOrgTab archetypeKey="ifc" {...baseProps} canManage={false} />,
    );
    expect(
      screen.getByRole("button", { name: /save profile/i }),
    ).toBeDisabled();
  });
});

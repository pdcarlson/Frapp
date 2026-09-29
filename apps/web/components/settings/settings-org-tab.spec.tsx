import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MAX_UPLOAD_LABEL } from "@repo/validation";
import { SettingsOrgTab } from "./settings-org-tab";

const baseMark = {
  logoUrl: null,
  onUploadLogo: async () => {},
  onRemoveLogo: async () => {},
};

const baseProps = {
  vocabulary: {} as Record<string, string>,
  branding: {},
  profile: { name: "Test Chapter", university: "State U", donation_url: "" },
  mark: baseMark,
  canManage: true,
  canEditProfile: true,
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

  it("gates Save profile on the profile permission, not on config", () => {
    // `PATCH /v1/chapters/current` guards on `CHAPTER_PROFILE_PERMISSIONS`, so
    // the profile save follows `canEditProfile`; the config saves follow
    // `canManage` (#2575). Each save reads the gate its own route checks.
    const { rerender } = render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        canManage={false}
        canEditProfile
      />,
    );
    expect(screen.getByRole("button", { name: /save profile/i })).toBeEnabled();
    rerender(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        canManage
        canEditProfile={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /save profile/i }),
    ).toBeDisabled();
  });

  it("names both profile permissions when the caller lacks them", () => {
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        canEditProfile={false}
      />,
    );
    // Twice: under the profile save and under the Chapter mark's logo
    // controls, which the same routes' permissions gate.
    expect(
      screen.getAllByText(
        (_, node) =>
          node?.tagName === "P" &&
          node.textContent ===
            "Editing chapter settings requires the chapter-config:view and chapter-config:manage permissions.",
      ),
    ).toHaveLength(2);
  });

  it("sends an emptied identity field as an empty string, so the clear saves", () => {
    // The config PATCH deep-merges: leaving the key out would keep the stored
    // letters, and the field the officer emptied would come back on reload.
    const onPatchConfig = vi.fn();
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        branding={{ greek_letters: "ΦΓΔ", designation: "Tau Nu" }}
        onPatchConfig={onPatchConfig}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^greek letters$/i), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save identity/i }));
    expect(onPatchConfig).toHaveBeenCalledWith({
      branding: { greek_letters: "", designation: "Tau Nu" },
    });
  });
});

describe("SettingsOrgTab chapter mark (#2876, #2591)", () => {
  function tile() {
    return screen.getAllByTestId(/chapter-mark-/)[0]!;
  }

  it("previews the precedence: short name before Greek letters", () => {
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        branding={{ greek_letters: "ΦΓΔ", short_name: "FIJI" }}
      />,
    );
    expect(tile()).toHaveTextContent("FIJI");
  });

  it("previews initials, not the stored letters, once the letters are turned off", async () => {
    const user = userEvent.setup();
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        branding={{ greek_letters: "ΦΓΔ" }}
      />,
    );
    expect(tile()).toHaveTextContent("ΦΓΔ");
    await user.click(screen.getByRole("switch", { name: /show greek letters/i }));
    expect(tile()).toHaveTextContent("TC");
    expect(tile()).not.toHaveTextContent("ΦΓΔ");
  });

  it("previews the logo ahead of everything", () => {
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        branding={{ greek_letters: "ΦΓΔ", short_name: "FIJI" }}
        mark={{ ...baseMark, logoUrl: "https://storage.example/logo.png" }}
      />,
    );
    expect(screen.getByTestId("chapter-mark-logo")).toHaveAttribute(
      "src",
      "https://storage.example/logo.png",
    );
  });

  it("saves the short name and the opt-out through the config PATCH", async () => {
    const user = userEvent.setup();
    const onPatchConfig = vi.fn();
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        branding={{ greek_letters: "ΦΓΔ" }}
        onPatchConfig={onPatchConfig}
      />,
    );
    await user.type(screen.getByLabelText(/short name/i), "FIJI");
    await user.click(screen.getByRole("switch", { name: /show greek letters/i }));
    await user.click(screen.getByRole("button", { name: /save mark/i }));
    expect(onPatchConfig).toHaveBeenCalledWith({
      branding: { short_name: "FIJI", show_greek_letters: false },
    });
  });

  it("clears a stored short name with an empty string", async () => {
    const user = userEvent.setup();
    const onPatchConfig = vi.fn();
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        branding={{ short_name: "FIJI" }}
        onPatchConfig={onPatchConfig}
      />,
    );
    await user.clear(screen.getByLabelText(/short name/i));
    await user.click(screen.getByRole("button", { name: /save mark/i }));
    expect(onPatchConfig).toHaveBeenCalledWith({
      branding: { short_name: "", show_greek_letters: true },
    });
  });

  it("uploads a picked image through onUploadLogo", async () => {
    const user = userEvent.setup();
    const onUploadLogo = vi.fn(async () => {});
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        mark={{ ...baseMark, onUploadLogo }}
      />,
    );
    const file = new File(["png"], "crest.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/^logo$/i), file);
    expect(onUploadLogo).toHaveBeenCalledWith({
      body: file,
      filename: "crest.png",
      contentType: "image/png",
    });
  });

  it("refuses a file outside the image kind and says why, without uploading", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onUploadLogo = vi.fn(async () => {});
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        mark={{ ...baseMark, onUploadLogo }}
      />,
    );
    await user.upload(
      screen.getByLabelText(/^logo$/i),
      new File(["<svg/>"], "crest.svg", { type: "image/svg+xml" }),
    );
    expect(onUploadLogo).not.toHaveBeenCalled();
    expect(
      screen.getByText("Choose an image file: .jpg, .jpeg, .png, .gif or .webp."),
    ).toBeInTheDocument();
  });

  it("refuses an oversized file with the shared size label, keeping other drafts", async () => {
    const user = userEvent.setup();
    const onUploadLogo = vi.fn(async () => {});
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        branding={{ designation: "Tau Nu" }}
        mark={{ ...baseMark, onUploadLogo }}
      />,
    );
    await user.type(screen.getByLabelText(/short name/i), "FIJI");
    await user.clear(screen.getByLabelText(/chapter designation/i));
    await user.type(screen.getByLabelText(/chapter designation/i), "Tau Nu II");
    const huge = new File(["x"], "crest.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: 26 * 1024 * 1024 });
    await user.upload(screen.getByLabelText(/^logo$/i), huge);

    expect(onUploadLogo).not.toHaveBeenCalled();
    expect(
      screen.getByText(`That file is too large. Logos can be up to ${MAX_UPLOAD_LABEL}.`),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/short name/i)).toHaveValue("FIJI");
    expect(screen.getByLabelText(/chapter designation/i)).toHaveValue("Tau Nu II");
  });

  it("keeps unsaved drafts when the page re-renders with the same stored values", async () => {
    // The page rebuilds `branding` and `profile` on every render. A logo
    // upload starting re-renders it; that must not throw away typed edits.
    const user = userEvent.setup();
    const { rerender } = render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        branding={{ greek_letters: "ΦΓΔ" }}
      />,
    );
    await user.type(screen.getByLabelText(/short name/i), "FIJI");
    await user.click(screen.getByRole("switch", { name: /show greek letters/i }));
    await user.type(screen.getByLabelText(/chapter name/i), " II");

    rerender(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        profile={{ ...baseProps.profile }}
        branding={{ greek_letters: "ΦΓΔ" }}
        mark={{ ...baseMark, logoPending: true }}
      />,
    );

    expect(screen.getByLabelText(/short name/i)).toHaveValue("FIJI");
    expect(
      screen.getByRole("switch", { name: /show greek letters/i }),
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText(/chapter name/i)).toHaveValue("Test Chapter II");
  });

  it("re-seeds the drafts when the stored values really change", () => {
    const { rerender } = render(
      <SettingsOrgTab archetypeKey="ifc" {...baseProps} branding={{}} />,
    );
    rerender(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        branding={{ short_name: "FIJI", show_greek_letters: false }}
      />,
    );
    expect(screen.getByLabelText(/short name/i)).toHaveValue("FIJI");
    expect(
      screen.getByRole("switch", { name: /show greek letters/i }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("offers replace and remove once a logo is set", async () => {
    const user = userEvent.setup();
    const onRemoveLogo = vi.fn(async () => {});
    render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        mark={{
          ...baseMark,
          logoUrl: "https://storage.example/logo.png",
          onRemoveLogo,
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /replace logo/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /remove logo/i }));
    expect(onRemoveLogo).toHaveBeenCalledTimes(1);
  });

  it("gates the logo on the profile permissions and the mark save on config:manage", () => {
    // Two routes, two gates: the logo routes guard like the profile PATCH
    // (#2575), the short name and opt-out go through the config PATCH.
    const { rerender } = render(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        canEditProfile={false}
        canManage
      />,
    );
    expect(screen.getByRole("button", { name: /upload logo/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save mark/i })).toBeEnabled();

    rerender(
      <SettingsOrgTab
        archetypeKey="ifc"
        {...baseProps}
        canEditProfile
        canManage={false}
      />,
    );
    expect(screen.getByRole("button", { name: /upload logo/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /save mark/i })).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: /show greek letters/i }),
    ).toBeDisabled();
  });
});

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

  it("paints neither tier in the chapter accent, nor in a semantic hue", () => {
    /*
     * The call-site half of the guard, and the half that matters.
     * `status-kind.test.ts` asserts `moduleTierKind` never returns `default`
     * or `secondary`, but the defect it exists for was an inline ternary that
     * never called a mapper at all — `border-primary/40 text-primary` for
     * Chapter Pro and `border-success/50 text-success` for Free. A mapper-level
     * invariant is blind to that, which is what the Resources & Reporting
     * slice found on `/polls`. So this reads the rendered classes.
     *
     * Verified the way that slice verified its own: by reverting the call site
     * to the ternary and watching this fail while `status-kind.test.ts` stayed
     * green.
     */
    render(
      <SettingsModulesTab enabledModules={{}} canManage onToggle={() => {}} />,
    );
    for (const label of ["Free", "Chapter Pro"]) {
      for (const badge of screen.getAllByText(label)) {
        const className = badge.className;
        // §5's Accent kind, i.e. the chapter's own colour on a price tag.
        expect(className, label).not.toMatch(/\btext-accent-text\b/);
        expect(className, label).not.toMatch(/\bbg-accent-subtle\b/);
        // The raw-token spellings the ternary used, which bypassed `Badge`.
        expect(className, label).not.toMatch(/\btext-primary\b/);
        expect(className, label).not.toMatch(/\btext-success\b/);
        expect(className, label).not.toMatch(/border-(primary|success)\//);
        // §5's Hairline, which is what a tier is.
        expect(className, label).toMatch(/\btext-muted-foreground\b/);
      }
    }
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
  // AC 2 of #492: chat's ops-setup nudge links here with `?module=<key>`, and
  // its whole value over a bare `?tab=modules` is landing the officer on the
  // row it named rather than at the top of the full module list.
  describe("focusModuleKey", () => {
    it("focuses the named module's switch", () => {
      render(
        <SettingsModulesTab
          enabledModules={{ dues: false }}
          canManage
          onToggle={() => {}}
          focusModuleKey="dues"
        />,
      );
      expect(screen.getByRole("switch", { name: /dues enabled/i })).toHaveFocus();
    });

    it("focuses nothing when no module is named", () => {
      render(
        <SettingsModulesTab
          enabledModules={{ dues: false }}
          canManage
          onToggle={() => {}}
        />,
      );
      expect(
        screen.getByRole("switch", { name: /dues enabled/i }),
      ).not.toHaveFocus();
      expect(document.body).toHaveFocus();
    });

    // A locked row has no switch at all, so the effect must find no control
    // and do nothing rather than throw on a null ref.
    it("does not throw when the named module is always-on", () => {
      expect(() =>
        render(
          <SettingsModulesTab
            enabledModules={{}}
            canManage
            onToggle={() => {}}
            focusModuleKey="chat"
          />,
        ),
      ).not.toThrow();
    });

    // Only the named row. An effect that ran on every row would leave focus on
    // whichever mounted last.
    it("leaves the other rows unfocused", () => {
      render(
        <SettingsModulesTab
          enabledModules={{ dues: false, tasks: false }}
          canManage
          onToggle={() => {}}
          focusModuleKey="tasks"
        />,
      );
      expect(screen.getByRole("switch", { name: /tasks enabled/i })).toHaveFocus();
      expect(
        screen.getByRole("switch", { name: /dues enabled/i }),
      ).not.toHaveFocus();
    });
  });
});

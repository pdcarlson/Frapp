import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { OrgWorkflow } from "@repo/hooks";
import {
  expectClearingEntriesEmpty,
  expectRefusedEntriesKeep,
} from "@/tests/numeric-input";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { SettingsWorkflowsTab } from "./settings-workflows-tab";

const WORKFLOWS: OrgWorkflow[] = [
  {
    key: "wf_budget_approval",
    label: "Budget approval",
    enabled: true,
    threshold: 500,
    units: "USD",
  },
  { key: "wf_task_confirm", label: "Task confirm", enabled: false },
];

describe("SettingsWorkflowsTab", () => {
  it("renders a switch per workflow and a threshold input only for enabled threshold workflows", () => {
    render(
      <SettingsWorkflowsTab
        workflows={WORKFLOWS}
        canManage
        onSave={() => {}}
      />,
    );
    expect(
      screen.getByRole("switch", { name: /budget approval enabled/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("switch", { name: /task confirm enabled/i }),
    ).not.toBeChecked();
    // Enabled + threshold-bearing → numeric input present, prefilled.
    expect(
      screen.getByRole("spinbutton", { name: /budget approval threshold/i }),
    ).toHaveValue(500);
    // Non-threshold workflow → no input.
    expect(
      screen.queryByRole("spinbutton", { name: /task confirm threshold/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the threshold input when its workflow is toggled off", () => {
    render(
      <SettingsWorkflowsTab
        workflows={WORKFLOWS}
        canManage
        onSave={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("switch", { name: /budget approval enabled/i }),
    );
    expect(
      screen.queryByRole("spinbutton", { name: /budget approval threshold/i }),
    ).not.toBeInTheDocument();
  });

  describe("the threshold (#3050)", () => {
    beforeEach(() => mockToast.mockReset());

    const threshold = () =>
      screen.getByRole("spinbutton", { name: /budget approval threshold/i });
    const save = () =>
      fireEvent.click(screen.getByRole("button", { name: /save workflows/i }));

    it("keeps the last whole number through a negative or a decimal", () => {
      render(
        <SettingsWorkflowsTab
          workflows={WORKFLOWS}
          canManage
          onSave={vi.fn()}
        />,
      );
      expectRefusedEntriesKeep(threshold(), "750");
    });

    it("lets the field be emptied mid-edit, then refuses it at save by name", () => {
      const onSave = vi.fn();
      render(
        <SettingsWorkflowsTab
          workflows={WORKFLOWS}
          canManage
          onSave={onSave}
        />,
      );
      expectClearingEntriesEmpty(threshold(), "750");
      save();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "The threshold for “Budget approval” needs a number",
          variant: "destructive",
        }),
      );
      expect(onSave).not.toHaveBeenCalled();
    });

    it("saves a threshold of 0, its floor", () => {
      const onSave = vi.fn();
      render(
        <SettingsWorkflowsTab
          workflows={WORKFLOWS}
          canManage
          onSave={onSave}
        />,
      );
      fireEvent.change(threshold(), { target: { value: "0" } });
      expect(threshold()).toHaveValue(0);
      save();
      expect(onSave).toHaveBeenCalledWith([
        { key: "wf_budget_approval", enabled: true, threshold: 0 },
        { key: "wf_task_confirm", enabled: false },
      ]);
    });

    it("leaves a disabled workflow's emptied threshold out of the save", () => {
      const onSave = vi.fn();
      render(
        <SettingsWorkflowsTab
          workflows={WORKFLOWS}
          canManage
          onSave={onSave}
        />,
      );
      fireEvent.change(threshold(), { target: { value: "" } });
      fireEvent.click(
        screen.getByRole("switch", { name: /budget approval enabled/i }),
      );
      save();
      expect(mockToast).not.toHaveBeenCalled();
      expect(onSave).toHaveBeenCalledWith([
        { key: "wf_budget_approval", enabled: false },
        { key: "wf_task_confirm", enabled: false },
      ]);
    });
  });

  it("saves the full workflow array with current enabled + threshold state", () => {
    const onSave = vi.fn();
    render(
      <SettingsWorkflowsTab workflows={WORKFLOWS} canManage onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save workflows/i }));
    expect(onSave).toHaveBeenCalledWith([
      { key: "wf_budget_approval", enabled: true, threshold: 500 },
      { key: "wf_task_confirm", enabled: false },
    ]);
  });

  it("disables controls when the caller cannot manage", () => {
    render(
      <SettingsWorkflowsTab
        workflows={WORKFLOWS}
        canManage={false}
        onSave={() => {}}
      />,
    );
    expect(
      screen.getByRole("switch", { name: /budget approval enabled/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /save workflows/i }),
    ).toBeDisabled();
  });
});

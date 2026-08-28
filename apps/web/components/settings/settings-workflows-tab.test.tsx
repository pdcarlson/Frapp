import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsWorkflowsTab } from "./settings-workflows-tab";
import type { OrgWorkflow } from "@repo/hooks";

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

  it("guard-parses the threshold: a negative value is rejected (previous kept)", () => {
    render(
      <SettingsWorkflowsTab
        workflows={WORKFLOWS}
        canManage
        onSave={() => {}}
      />,
    );
    const input = screen.getByRole("spinbutton", {
      name: /budget approval threshold/i,
    });
    fireEvent.change(input, { target: { value: "-5" } });
    expect(input).toHaveValue(500); // unchanged — NaN/negative never committed
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(500); // empty preserves previous (Number("") is 0)
    fireEvent.change(input, { target: { value: "750" } });
    expect(input).toHaveValue(750);
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

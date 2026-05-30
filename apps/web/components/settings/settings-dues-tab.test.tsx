import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsDuesTab } from "./settings-dues-tab";
import type { OrgDues } from "@/lib/hooks/use-org-config";

const DUES: OrgDues = {
  cadence: "per_semester",
  active_amount_cents: 85000,
  new_member_amount_cents: 42500,
  alumni_amount_cents: 0,
  installments_allowed: false,
  installment_count: 1,
  late_fee_cents: 2500,
  grace_days: 7,
  scholarship_pool_cents: 120000,
};

describe("SettingsDuesTab", () => {
  it("prefills the per-class amount and grace inputs from the dues config", () => {
    render(<SettingsDuesTab dues={DUES} canManage onSave={() => {}} />);
    expect(
      screen.getByRole("spinbutton", { name: /active member dues/i }),
    ).toHaveValue(85000);
    expect(
      screen.getByRole("spinbutton", { name: /grace period/i }),
    ).toHaveValue(7);
  });

  it("shows the installment count only while installments are allowed", () => {
    render(<SettingsDuesTab dues={DUES} canManage onSave={() => {}} />);
    // Off by default → no count input.
    expect(
      screen.queryByRole("spinbutton", { name: /number of installments/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /allow installments/i }));
    expect(
      screen.getByRole("spinbutton", { name: /number of installments/i }),
    ).toBeInTheDocument();
  });

  it("guard-parses a cents input: negative/empty rejected (previous kept)", () => {
    render(<SettingsDuesTab dues={DUES} canManage onSave={() => {}} />);
    const input = screen.getByRole("spinbutton", {
      name: /active member dues/i,
    });
    fireEvent.change(input, { target: { value: "-5" } });
    expect(input).toHaveValue(85000); // negative never committed
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(85000); // empty preserves previous
    fireEvent.change(input, { target: { value: "1.5" } });
    expect(input).toHaveValue(85000); // non-integer rejected
    fireEvent.change(input, { target: { value: "90000" } });
    expect(input).toHaveValue(90000);
  });

  it("guard-parses the installment count: rejects values below 1", () => {
    render(<SettingsDuesTab dues={DUES} canManage onSave={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: /allow installments/i }));
    const count = screen.getByRole("spinbutton", {
      name: /number of installments/i,
    });
    fireEvent.change(count, { target: { value: "0" } });
    expect(count).toHaveValue(1); // 0 rejected (count must be >= 1)
    fireEvent.change(count, { target: { value: "4" } });
    expect(count).toHaveValue(4);
  });

  it("saves the full dues config with current state", () => {
    const onSave = vi.fn();
    render(<SettingsDuesTab dues={DUES} canManage onSave={onSave} />);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /late fee/i }),
      { target: { value: "3000" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /save dues/i }));
    expect(onSave).toHaveBeenCalledWith({ ...DUES, late_fee_cents: 3000 });
  });

  it("disables controls when the caller cannot manage", () => {
    render(<SettingsDuesTab dues={DUES} canManage={false} onSave={() => {}} />);
    expect(
      screen.getByRole("spinbutton", { name: /active member dues/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: /allow installments/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /save dues/i })).toBeDisabled();
  });
});

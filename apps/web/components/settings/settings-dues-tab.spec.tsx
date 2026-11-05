import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { OrgDues } from "@repo/hooks";
import { expectRefusedEntriesKeep } from "@/tests/numeric-input";

const mockToast = vi.fn();
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { SettingsDuesTab } from "./settings-dues-tab";

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
    render(
      <SettingsDuesTab
        dues={DUES}
        canManage
        onSave={() => {}}
        pledgeTerm="New member"
      />,
    );
    // Typed and shown in dollars; stored in cents.
    expect(
      screen.getByRole("textbox", { name: /active member dues/i }),
    ).toHaveValue("850");
    expect(screen.getByRole("textbox", { name: /late fee/i })).toHaveValue(
      "25",
    );
    expect(
      screen.getByRole("spinbutton", { name: /grace period/i }),
    ).toHaveValue(7);
  });

  it("shows the installment count only while installments are allowed", () => {
    render(
      <SettingsDuesTab
        dues={DUES}
        canManage
        onSave={() => {}}
        pledgeTerm="New member"
      />,
    );
    // Off by default → no count input.
    expect(
      screen.queryByRole("spinbutton", { name: /number of installments/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("switch", { name: /allow installments/i }),
    );
    expect(
      screen.getByRole("spinbutton", { name: /number of installments/i }),
    ).toBeInTheDocument();
  });

  describe("numeric fields (#3050)", () => {
    beforeEach(() => mockToast.mockReset());

    function renderTab(onSave = vi.fn(), dues = DUES) {
      render(
        <SettingsDuesTab
          dues={dues}
          canManage
          onSave={onSave}
          pledgeTerm="New member"
        />,
      );
      return onSave;
    }
    const field = (name: RegExp) => screen.getByRole("spinbutton", { name });
    const amount = (name: RegExp) => screen.getByRole("textbox", { name });
    const save = () =>
      fireEvent.click(screen.getByRole("button", { name: /save dues/i }));

    it("keeps the last whole number through a negative or a decimal", () => {
      renderTab();
      expectRefusedEntriesKeep(field(/grace period/i), "3");
    });

    it("keeps the last amount through anything that isn't dollars and cents", () => {
      renderTab();
      const active = amount(/active member dues/i);
      fireEvent.change(active, { target: { value: "42.5" } });
      for (const entry of ["-3", "42.505", "abc", "1e3"]) {
        fireEvent.change(active, { target: { value: entry } });
        expect(active, `after typing ${entry}`).toHaveValue("42.5");
      }
    });

    it("lets an amount be emptied mid-edit instead of snapping back", () => {
      renderTab();
      fireEvent.change(amount(/late fee/i), { target: { value: "" } });
      expect(amount(/late fee/i)).toHaveValue("");
    });

    it("keeps the 0 left by deleting the 1 of 10 installments, then refuses it at save", () => {
      const onSave = renderTab(vi.fn(), {
        ...DUES,
        installments_allowed: true,
        installment_count: 10,
      });
      fireEvent.change(field(/number of installments/i), {
        target: { value: "0" },
      });
      expect(field(/number of installments/i)).toHaveValue(0);
      // A button click, so the form's native `min={1}` check would block it
      // without `noValidate`.
      save();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Number of installments starts at 1",
          variant: "destructive",
        }),
      );
      expect(onSave).not.toHaveBeenCalled();

      fireEvent.change(field(/number of installments/i), {
        target: { value: "20" },
      });
      save();
      expect(onSave).toHaveBeenCalledWith({
        ...DUES,
        installments_allowed: true,
        installment_count: 20,
      });
    });

    it("refuses an emptied amount at save by name, and sends nothing", () => {
      const onSave = renderTab();
      fireEvent.change(amount(/alumni dues/i), { target: { value: "" } });
      save();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Alumni dues needs an amount" }),
      );
      expect(onSave).not.toHaveBeenCalled();
    });

    it("saves a hidden installment count as stored when installments are off", () => {
      const onSave = renderTab(vi.fn(), {
        ...DUES,
        installments_allowed: true,
        installment_count: 4,
      });
      fireEvent.change(field(/number of installments/i), {
        target: { value: "" },
      });
      fireEvent.click(
        screen.getByRole("switch", { name: /allow installments/i }),
      );
      save();
      expect(mockToast).not.toHaveBeenCalled();
      expect(onSave).toHaveBeenCalledWith({
        ...DUES,
        installments_allowed: false,
        installment_count: 4,
      });
    });
  });

  it("saves the full dues config with current state", () => {
    const onSave = vi.fn();
    render(
      <SettingsDuesTab
        dues={DUES}
        canManage
        onSave={onSave}
        pledgeTerm="New member"
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /late fee/i }), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /alumni dues/i }), {
      target: { value: "$12.75" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save dues/i }));
    expect(onSave).toHaveBeenCalledWith({
      ...DUES,
      late_fee_cents: 3000,
      alumni_amount_cents: 1275,
    });
  });

  it("keeps whole cents for amounts floating point can't hold exactly", () => {
    // 19.99 * 100 is 1998.9999999999998 in floating point: truncating it
    // would bill a cent short on every invoice.
    const onSave = vi.fn();
    render(
      <SettingsDuesTab
        dues={DUES}
        canManage
        onSave={onSave}
        pledgeTerm="New member"
      />,
    );
    for (const [name, value] of [
      [/active member dues/i, "19.99"],
      [/new member dues/i, "4.35"],
      [/late fee/i, "0.29"],
    ] as const) {
      fireEvent.change(screen.getByRole("textbox", { name }), {
        target: { value },
      });
    }
    fireEvent.click(screen.getByRole("button", { name: /save dues/i }));
    expect(onSave).toHaveBeenCalledWith({
      ...DUES,
      active_amount_cents: 1999,
      new_member_amount_cents: 435,
      late_fee_cents: 29,
    });
  });

  it("shows a stored amount with its cents as dollars and two decimals", () => {
    render(
      <SettingsDuesTab
        dues={{ ...DUES, active_amount_cents: 4250, late_fee_cents: 1999 }}
        canManage
        onSave={() => {}}
        pledgeTerm="New member"
      />,
    );
    expect(
      screen.getByRole("textbox", { name: /active member dues/i }),
    ).toHaveValue("42.50");
    expect(screen.getByRole("textbox", { name: /late fee/i })).toHaveValue(
      "19.99",
    );
  });

  // #351: the "new member" amount field's label reads in the chapter's own
  // vocabulary rather than a hardcoded IFC term.
  it("labels the pledge-tier dues field with the chapter's own vocabulary term", () => {
    render(
      <SettingsDuesTab
        dues={DUES}
        canManage
        onSave={() => {}}
        pledgeTerm="Aspirant"
      />,
    );
    expect(
      screen.getByRole("textbox", { name: /aspirant dues/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /new member dues/i }),
    ).not.toBeInTheDocument();
  });

  it("disables controls when the caller cannot manage", () => {
    render(
      <SettingsDuesTab
        dues={DUES}
        canManage={false}
        onSave={() => {}}
        pledgeTerm="New member"
      />,
    );
    expect(
      screen.getByRole("textbox", { name: /active member dues/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: /allow installments/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /save dues/i })).toBeDisabled();
  });
});

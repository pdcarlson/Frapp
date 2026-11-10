import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportMenu } from "./export-menu";

const { exportRowsSpy, toastSpy } = vi.hoisted(() => ({
  exportRowsSpy: vi.fn(async () => {}),
  toastSpy: vi.fn(),
}));

vi.mock("@/lib/utils", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
  return { ...actual, exportRows: exportRowsSpy };
});

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const rows = [{ Amount: "12" }, { Amount: "-5" }];

function renderMenu(props: Partial<Parameters<typeof ExportMenu>[0]> = {}) {
  return render(
    <ExportMenu
      label="Export selected"
      filenamePrefix="points"
      getRows={() => rows}
      {...props}
    />,
  );
}

async function pick(name: string) {
  await userEvent.click(
    screen.getByRole("button", { name: /export selected/i }),
  );
  await userEvent.click(await screen.findByRole("menuitem", { name }));
}

// #3969: one menu, used by Points, Billing and Reports.
describe("ExportMenu", () => {
  beforeEach(() => {
    exportRowsSpy.mockReset();
    exportRowsSpy.mockImplementation(async () => {});
    toastSpy.mockReset();
    window.localStorage.clear();
  });

  it("offers CSV, Excel and Copy for Google Sheets, and exports nothing until one is picked", async () => {
    renderMenu();
    await userEvent.click(
      screen.getByRole("button", { name: /export selected/i }),
    );

    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ).toEqual(["CSV", "Excel (.xlsx)", "Copy for Google Sheets"]);
    expect(exportRowsSpy).not.toHaveBeenCalled();
  });

  it("exports the caller's rows in the picked format", async () => {
    const onExported = vi.fn();
    renderMenu({ onExported });
    await pick("Excel (.xlsx)");

    expect(exportRowsSpy).toHaveBeenCalledWith(rows, "points", "xlsx");
    expect(onExported).toHaveBeenCalledWith("xlsx");
    // A download announces itself; only the clipboard copy needs a notice.
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("says the rows were copied and where to paste them", async () => {
    renderMenu();
    await pick("Copy for Google Sheets");

    expect(exportRowsSpy).toHaveBeenCalledWith(rows, "points", "sheets");
    expect(toastSpy).toHaveBeenCalledWith({
      title: "Copied 2 rows",
      description: "Paste into a Google Sheet.",
    });
  });

  it("marks the format this browser used last", async () => {
    renderMenu();
    await pick("Excel (.xlsx)");
    await userEvent.click(
      screen.getByRole("button", { name: /export selected/i }),
    );

    expect(
      await screen.findByRole("menuitem", { name: /Excel \(\.xlsx\).*Last used/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "CSV" })).toBeInTheDocument();
  });

  it("says so when the export fails, and does not remember that format", async () => {
    exportRowsSpy.mockImplementation(async () => {
      throw new Error("denied");
    });
    const onExported = vi.fn();
    renderMenu({ onExported });
    await pick("Copy for Google Sheets");

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't copy the rows",
        variant: "destructive",
      }),
    );
    expect(onExported).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("frapp.export-format")).toBeNull();
  });

  it("is disabled when the caller has nothing to export", () => {
    renderMenu({ disabled: true });
    expect(
      screen.getByRole("button", { name: /export selected/i }),
    ).toBeDisabled();
  });
});

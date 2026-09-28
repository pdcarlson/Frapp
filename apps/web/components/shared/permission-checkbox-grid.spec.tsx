import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PermissionCheckboxGrid } from "./permission-checkbox-grid";

describe("PermissionCheckboxGrid", () => {
  it("lists a selected gate the catalog does not, so it can be seen and unticked (#2818)", () => {
    // A channel imported "Same as Discord" whose role was deleted since: no
    // role holds the permission, so no catalog lists it.
    const onToggle = vi.fn();
    render(
      <PermissionCheckboxGrid
        catalog={[{ key: "MEMBERS_VIEW", permission: "members:view" }]}
        catalogLoading={false}
        catalogUnavailable={false}
        selected={new Set(["channels:read:exec"])}
        holders={new Map([["members:view", ["Member"]]])}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByText("channels:read:exec")).toBeInTheDocument();
    expect(screen.getByText("no role holds this")).toBeInTheDocument();
    const box = screen.getAllByRole("checkbox")[1] as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledWith("channels:read:exec");
  });

  it("claims nothing about holders when it is given none", () => {
    // Chat admin passes no holders until the roles have loaded, so a slow
    // or failed roles read never reads as "no role holds this".
    render(
      <PermissionCheckboxGrid
        catalog={[{ key: "MEMBERS_VIEW", permission: "members:view" }]}
        catalogLoading={false}
        catalogUnavailable={false}
        selected={new Set()}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByText("no role holds this")).not.toBeInTheDocument();
  });
});

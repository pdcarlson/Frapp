import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PermissionCheckboxGrid } from "./permission-checkbox-grid";

const { network } = vi.hoisted(() => ({ network: { isOffline: false } }));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => network,
}));

beforeEach(() => {
  network.isOffline = false;
});

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

  describe("offline, the catalog's state is the connection's, not a permission (#2267)", () => {
    function renderCatalog(state: { loading: boolean; unavailable: boolean }) {
      render(
        <PermissionCheckboxGrid
          catalog={[]}
          catalogLoading={state.loading}
          catalogUnavailable={state.unavailable}
          selected={new Set()}
          onToggle={() => {}}
        />,
      );
    }

    it("reports a catalog that failed offline as offline, without blaming members:view", () => {
      // A document that mounted offline, or an unreachable API: the read ran
      // and failed, so it arrives here as `catalogUnavailable`.
      network.isOffline = true;
      renderCatalog({ loading: false, unavailable: true });
      expect(screen.getByText(/can't load the permission list/i)).toBeInTheDocument();
      expect(screen.queryByText("members:view")).not.toBeInTheDocument();
    });

    it("reports a catalog paused offline as offline, not as loading", () => {
      network.isOffline = true;
      renderCatalog({ loading: true, unavailable: false });
      expect(screen.getByText(/can't load the permission list/i)).toBeInTheDocument();
      expect(screen.queryByText(/loading permissions/i)).not.toBeInTheDocument();
    });

    it("still names the missing permission when the catalog fails online", () => {
      renderCatalog({ loading: false, unavailable: true });
      expect(screen.getByText("members:view")).toBeInTheDocument();
      expect(screen.queryByText(/can't load the permission list/i)).not.toBeInTheDocument();
    });
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Board `4c`, on the page that sets the pattern.
 *
 * `4c` pin 1 says the same gear and the same drawer go on every page, so what
 * is pinned here is the contract a second adopter inherits: the width, the
 * autosave line standing in for a Save button, and the Access section reading
 * the live roles rather than a copy. The sections `4c` draws on Events and this
 * page does **not** have are pinned too, as absences — a later lane adding a
 * Defaults section here should have to delete a test that says why there isn't
 * one.
 */

const { roles, catalog } = vi.hoisted(() => ({
  roles: { data: undefined as unknown, isPending: false, isError: false },
  catalog: { data: undefined as unknown, isPending: false, isError: false },
}));

vi.mock("@repo/hooks", () => ({
  useRoles: () => roles,
  usePermissionsCatalog: () => catalog,
}));

import { StudyZonesSettingsDrawer } from "./study-zones-settings-drawer";

const CATALOG = [
  { key: "Manage study zones", permission: "geofences:manage" },
  { key: "View members", permission: "members:view" },
];

beforeEach(() => {
  Object.assign(roles, {
    data: [
      { id: "r1", name: "President", permissions: ["*"] },
      { id: "r2", name: "Scholarship Chair", permissions: ["geofences:manage"] },
      { id: "r3", name: "Member", permissions: ["members:view"] },
    ],
    isPending: false,
    isError: false,
  });
  Object.assign(catalog, { data: CATALOG, isPending: false, isError: false });
});

async function openDrawer() {
  const user = userEvent.setup();
  render(<StudyZonesSettingsDrawer />);
  await user.click(screen.getByRole("button", { name: /study zones settings/i }));
  return user;
}

describe("the per-page settings drawer", () => {
  it("opens from a gear named for the page, not a bare icon", async () => {
    render(<StudyZonesSettingsDrawer />);
    // The gear carries the page in its accessible name because `4c` puts one
    // on every page: "Settings" alone would be three identical buttons to a
    // screen reader moving between routes.
    expect(
      screen.getByRole("button", { name: "Study Zones settings" }),
    ).toBeInTheDocument();
  });

  it("stands in for a Save button with the autosave line", async () => {
    await openDrawer();
    // `4c` pin 4: "Autosave, no Save button." The line is the only thing
    // telling the member their change stuck, so it is not optional furniture.
    expect(screen.getByText(/saved as you change/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  it("lists the roles that actually hold each geofence permission", async () => {
    await openDrawer();

    // Scholarship Chair holds it outright; President holds it through `*`.
    expect(screen.getByText("Scholarship Chair")).toBeInTheDocument();
    expect(screen.getByText("President")).toBeInTheDocument();
    // Member holds an unrelated permission and must not appear.
    expect(screen.queryByText("Member")).not.toBeInTheDocument();
  });

  it("derives its rows from the catalog's namespace, not a hardcoded list", async () => {
    // A `geofences:*` permission added to the catalog later should surface
    // here without this component being edited; an unrelated one never should.
    Object.assign(catalog, {
      data: [...CATALOG, { key: "Export zones", permission: "geofences:export" }],
    });
    await openDrawer();

    expect(screen.getByText("Export zones")).toBeInTheDocument();
    expect(screen.queryByText("View members")).not.toBeInTheDocument();
  });

  it("says so when a permission has no holder, rather than showing an empty row", async () => {
    Object.assign(roles, {
      data: [{ id: "r3", name: "Member", permissions: ["members:view"] }],
    });
    await openDrawer();

    expect(screen.getByText(/no role holds this yet/i)).toBeInTheDocument();
  });

  it("sends editing to the roles matrix instead of duplicating it", async () => {
    await openDrawer();
    // `4c`'s own footer: "Roles are managed in Roles." The drawer reports;
    // board `4e` is where a grant changes.
    expect(screen.getByRole("link", { name: "Roles" })).toHaveAttribute(
      "href",
      "/settings?tab=roles",
    );
  });

  it("draws no Defaults or Posts-to-chat section, because the API has neither", async () => {
    /*
     * `4c` pin 4 scopes those two sections to "per-module knobs the API
     * already has". Study zones keep their numbers per polygon, on each zone
     * row, and there is no chapter-level geofence config route. A Defaults
     * section here would either invent an endpoint or lift four per-zone
     * columns into something that looks like one chapter-wide setting.
     */
    await openDrawer();

    expect(screen.queryByText(/^defaults$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/posts to chat/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^access$/i)).toBeInTheDocument();
  });

  it("degrades to a pointer rather than an empty Access list when roles fail", async () => {
    Object.assign(roles, { data: undefined, isPending: false, isError: true });
    await openDrawer();

    // Never "no role holds this" — that is a claim, and the fetch failed.
    expect(screen.queryByText(/no role holds this yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load roles/i)).toBeInTheDocument();
  });
});

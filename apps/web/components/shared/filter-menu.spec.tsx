import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ActiveFilterChips,
  FilterMenu,
  type FilterMenuFilter,
} from "./filter-menu";

/*
 * The one web filter bar (rulebook § 9): a Filter button with a count, one
 * row per filter, Clear all in the menu, and the filters that are on as
 * removable chips under the header.
 */

function Harness({ manyRoles = false }: { manyRoles?: boolean }) {
  const [status, setStatus] = useState("any");
  const [role, setRole] = useState("any");
  const roles = manyRoles
    ? Array.from({ length: 12 }, (_, i) => ({
        value: `r${i}`,
        label: `Role ${i}`,
      }))
    : [{ value: "chair", label: "Chair" }];
  const filters: FilterMenuFilter[] = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "any", label: "Any" },
        { value: "active", label: "Active" },
      ],
      value: status,
      anyValue: "any",
      onChange: setStatus,
    },
    {
      key: "role",
      label: "Role",
      options: [{ value: "any", label: "Any" }, ...roles],
      value: role,
      anyValue: "any",
      onChange: setRole,
    },
  ];
  return (
    <>
      <FilterMenu filters={filters} thing="members" />
      <ActiveFilterChips filters={filters} />
    </>
  );
}

async function pick(
  user: ReturnType<typeof userEvent.setup>,
  group: string,
  option: string,
) {
  if (!screen.queryByRole("menu")) {
    await user.click(screen.getByRole("button", { name: /^Filter members/ }));
  }
  screen.getByRole("menuitem", { name: new RegExp(`^${group}`) }).focus();
  await user.keyboard("{ArrowRight}");
  await user.click(await screen.findByRole("menuitemradio", { name: option }));
}

describe("FilterMenu", () => {
  it("counts the filters that are on and removes one from its chip", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await pick(user, "Status", "Active");
    await pick(user, "Role", "Chair");

    expect(
      screen.getByRole("button", { name: "Filter members, 2 on" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Remove filter Status: Active" }),
    );
    expect(
      screen.getByRole("button", { name: "Filter members, 1 on" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove filter Status: Active" }),
    ).not.toBeInTheDocument();
    // Focus stays in the row instead of falling to the top of the page.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(
      screen.getByRole("button", { name: "Remove filter Role: Chair" }),
    ).toHaveFocus();

    await user.click(
      screen.getByRole("button", { name: "Remove filter Role: Chair" }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(
      screen.getByRole("button", { name: "Filter members" }),
    ).toHaveFocus();
  });

  it("clears every filter from the menu's Clear all", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await pick(user, "Status", "Active");

    await user.click(screen.getByRole("button", { name: /^Filter members/ }));
    await user.click(screen.getByRole("menuitem", { name: "Clear all" }));
    expect(
      screen.getByRole("button", { name: "Filter members" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Remove filter/ }),
    ).not.toBeInTheDocument();
  });

  it("offers a search field once a filter has many options", async () => {
    const user = userEvent.setup();
    render(<Harness manyRoles />);
    await user.click(screen.getByRole("button", { name: "Filter members" }));
    screen.getByRole("menuitem", { name: /^Role/ }).focus();
    await user.keyboard("{ArrowRight}");
    await user.type(await screen.findByLabelText("Search role"), "11");
    expect(
      screen.getByRole("menuitemradio", { name: "Role 11" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitemradio", { name: "Role 2" }),
    ).not.toBeInTheDocument();
  });
});

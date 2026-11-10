import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  FILTER_SEARCH_THRESHOLD,
  FilterChip,
} from "@/components/shared/filter-chip";

const SHORT = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
];

const LONG = [
  { value: "r-pres", label: "President" },
  { value: "r-vp", label: "Vice President" },
  { value: "r-treas", label: "Treasurer" },
  { value: "r-jose", label: "José's Committee" },
  ...Array.from({ length: 20 }, (_, i) => ({
    value: `r-${i}`,
    label: `Committee ${i + 1}`,
  })),
];

function setup(
  options: readonly { value: string; label: string }[],
  value: string | null = null,
  anyLabel: string | null = "Any role",
) {
  const onChange = vi.fn();
  render(
    <FilterChip
      label="Role"
      anyLabel={anyLabel ?? undefined}
      options={options}
      value={value}
      onChange={onChange}
    />,
  );
  return { user: userEvent.setup(), onChange };
}

describe("FilterChip", () => {
  it("keeps a short list a plain menu, with no search field", async () => {
    expect(SHORT.length).toBeLessThanOrEqual(FILTER_SEARCH_THRESHOLD);
    const { user, onChange } = setup(SHORT);
    await user.click(screen.getByRole("button", { name: "Role" }));
    expect(await screen.findAllByRole("menuitem")).toHaveLength(3);
    expect(screen.queryByRole("combobox")).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "Pending" }));
    expect(onChange).toHaveBeenCalledWith("pending");
  });

  it("opens a long list whole, with the field focused above it", async () => {
    const { user } = setup(LONG);
    await user.click(screen.getByRole("button", { name: "Role" }));
    const field = await screen.findByRole("combobox");
    expect(field).toHaveFocus();
    // Nothing is hidden behind the search: every option plus "Any role".
    expect(screen.getAllByRole("option")).toHaveLength(LONG.length + 1);
  });

  it("narrows by word start, ignoring case and accents, and restores on clear", async () => {
    const { user } = setup(LONG);
    await user.click(screen.getByRole("button", { name: "Role" }));
    const field = await screen.findByRole("combobox");

    await user.type(field, "pres");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["President", "Vice President"]);

    await user.clear(field);
    await user.type(field, "jose");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("José's Committee");

    await user.clear(field);
    expect(screen.getAllByRole("option")).toHaveLength(LONG.length + 1);
  });

  it("picks with the arrow keys and Enter", async () => {
    const { user, onChange } = setup(LONG);
    await user.click(screen.getByRole("button", { name: "Role" }));
    await user.type(await screen.findByRole("combobox"), "pres");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("r-vp");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("says so when nothing matches", async () => {
    const { user } = setup(LONG);
    await user.click(screen.getByRole("button", { name: "Role" }));
    await user.type(await screen.findByRole("combobox"), "zzz");
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing matches “zzz”.",
    );
  });

  it("clears the query on the first Escape and closes on the second", async () => {
    const { user } = setup(LONG);
    await user.click(screen.getByRole("button", { name: "Role" }));
    const field = await screen.findByRole("combobox");
    await user.type(field, "pres");

    await user.keyboard("{Escape}");
    expect(field).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(LONG.length + 1);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("clears the value from the Any row, and marks the chosen one", async () => {
    const { user, onChange } = setup(LONG, "r-treas");
    await user.click(screen.getByRole("button", { name: "Role: Treasurer" }));
    expect(
      await screen.findByRole("option", { name: /^Treasurer\s*\(selected\)$/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Any role" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("offers no clearing row without an anyLabel", async () => {
    const { user } = setup(LONG, null, null);
    await user.click(screen.getByRole("button", { name: "Role" }));
    await screen.findByRole("combobox");
    expect(screen.getAllByRole("option")).toHaveLength(LONG.length);
  });
});

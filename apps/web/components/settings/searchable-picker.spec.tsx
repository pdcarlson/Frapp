import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchablePicker } from "./searchable-picker";

const ITEMS = ["Rush chair", "Social chair", "Treasurer"];

function renderPicker(props: { grouped?: boolean; onPick?: () => void }) {
  render(
    <SearchablePicker
      trigger={<button type="button">Pick</button>}
      align="start"
      label="Pick a role"
      placeholder="Find a role"
      items={ITEMS}
      nameOf={(item) => item}
      keyOf={(item) => item}
      groupsOf={
        props.grouped
          ? (shown) => [
              {
                heading: "Chairs",
                items: shown.filter((i) => /chair/.test(i)),
              },
              {
                heading: "Officers",
                items: shown.filter((i) => !/chair/.test(i)),
              },
            ]
          : undefined
      }
      itemClassName="min-h-8"
      renderItem={(item) => <span>{item}</span>}
      onPick={props.onPick ?? (() => {})}
    />,
  );
}

/** The picker under "Who can" and Goals (#4608), on its own. */
describe("a searchable picker", () => {
  it("leaves out a heading the search empties", async () => {
    const user = userEvent.setup();
    renderPicker({ grouped: true });
    await user.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.getAllByRole("group")).toHaveLength(2);
    await user.type(screen.getByPlaceholderText("Find a role"), "tre");
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.queryByText("Chairs")).toBeNull();
    expect(screen.getByText("Officers")).toBeInTheDocument();
  });

  it("lists flat without groups, and hands back the pick", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    renderPicker({ onPick });
    await user.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.queryByRole("group")).toBeNull();
    await user.click(screen.getByRole("option", { name: "Social chair" }));
    expect(onPick).toHaveBeenCalledWith("Social chair");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { markupLines } from "@/tests/stable-markup";
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
) {
  const onChange = vi.fn();
  render(
    <FilterChip
      label="Role"
      anyLabel="Any role"
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

  it("puts the field on lists past the threshold, and only those", async () => {
    const options = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        value: `v${i}`,
        label: `Opt ${i}`,
      }));
    const user = userEvent.setup();
    const { unmount } = render(
      <FilterChip
        label="Role"
        anyLabel="Any role"
        options={options(FILTER_SEARCH_THRESHOLD)}
        value={null}
        onChange={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Role" }));
    await screen.findAllByRole("menuitem");
    expect(screen.queryByRole("combobox")).toBeNull();
    unmount();

    render(
      <FilterChip
        label="Role"
        anyLabel="Any role"
        options={options(FILTER_SEARCH_THRESHOLD + 1)}
        value={null}
        onChange={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Role" }));
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
  });

  it("hides the Any row while a query is typed, so Enter picks a real option", async () => {
    const { user, onChange } = setup(LONG);
    await user.click(screen.getByRole("button", { name: "Role" }));
    // "ro" starts a word of "Any role"; it must not be the row Enter takes.
    await user.type(await screen.findByRole("combobox"), "co");
    expect(screen.queryByRole("option", { name: "Any role" })).toBeNull();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("r-jose");
  });

  it("opens whole again after a query was typed and the list closed", async () => {
    const { user } = setup(LONG);
    await user.click(screen.getByRole("button", { name: "Role" }));
    await user.type(await screen.findByRole("combobox"), "pres");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Role" }));
    expect(await screen.findByRole("combobox")).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(LONG.length + 1);
  });

  it("names the field for a screen reader", async () => {
    const { user } = setup(LONG);
    await user.click(screen.getByRole("button", { name: "Role" }));
    expect(
      await screen.findByRole("combobox", { name: "Filter the Role list" }),
    ).toBeInTheDocument();
  });

  it("reads an option's short name on the chip, and a name with a dot whole", () => {
    render(
      <>
        <FilterChip
          label="Course"
          anyLabel="Any course"
          options={[
            { value: "c", label: "COGS 2120 · Cognition", short: "COGS 2120" },
          ]}
          value="c"
          onChange={() => {}}
        />
        <FilterChip
          label="Role"
          anyLabel="Any role"
          options={[{ value: "r", label: "Exec · Treasurer" }]}
          value="r"
          onChange={() => {}}
        />
      </>,
    );
    expect(
      screen.getByRole("button", { name: "Course: COGS 2120 · Cognition" }),
    ).toHaveTextContent(/^COGS 2120$/);
    expect(
      screen.getByRole("button", { name: "Role: Exec · Treasurer" }),
    ).toHaveTextContent("Exec · Treasurer");
  });

  it("on touch, leaves the field unfocused but keeps the keyboard working", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      const { user, onChange } = setup(LONG);
      await user.click(screen.getByRole("button", { name: "Role" }));
      const field = await screen.findByRole("combobox");
      expect(field).not.toHaveFocus();
      await user.keyboard("{ArrowDown}{Enter}");
      expect(onChange).toHaveBeenCalledWith("r-pres");
    } finally {
      window.matchMedia = original;
    }
  });

  it("draws the long list exactly as before (#5264)", async () => {
    const nine = Array.from(
      { length: FILTER_SEARCH_THRESHOLD + 1 },
      (_, i) => ({
        value: `r-${i}`,
        label: `Committee ${i + 1}`,
      }),
    );
    const { user } = setup(nine, "r-2");
    await user.click(screen.getByRole("button", { name: "Role: Committee 3" }));
    expect(markupLines(screen.getByRole("dialog"))).toMatchInlineSnapshot(`
      [
        "<div class="z-50 rounded-md border border-border bg-popover text-popover-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin] w-max min-w-[15rem] max-w-[min(26rem,calc(100vw-2rem))] p-0" data-align="start" data-side="bottom" data-state="open" role="dialog" style="--radix-popover-content-transform-origin: var(--radix-popper-transform-origin); --radix-popover-content-available-width: var(--radix-popper-available-width); --radix-popover-content-available-height: var(--radix-popper-available-height); --radix-popover-trigger-width: var(--radix-popper-anchor-width); --radix-popover-trigger-height: var(--radix-popper-anchor-height);" tabindex="-1">",
        "  <div class="flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground outline-none" cmdk-root="" tabindex="-1">",
        "    <label cmdk-label="" style="position: absolute; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; border-width: 0px;">Filter the Role list",
        "    <div class="flex items-center border-b border-border px-3" cmdk-input-wrapper="">",
        "      <svg aria-hidden="true" class="lucide lucide-search mr-2 h-4 w-4 shrink-0 text-muted">",
        "      <input aria-autocomplete="list" aria-expanded="true" autocomplete="off" autocorrect="off" class="flex w-full rounded-md bg-transparent text-foreground caret-primary outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:text-disabled h-9 py-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base" cmdk-input="" placeholder="Type to filter" role="combobox" spellcheck="false" type="text" value="">",
        "    <div aria-label="Suggestions" class="overflow-y-auto overflow-x-hidden max-h-72 p-1" cmdk-list="" role="listbox" tabindex="-1">",
        "      <div cmdk-list-sizer="">",
        "        <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="\u0000any" role="option">",
        "          <svg aria-hidden="true" class="lucide lucide-check h-4 w-4 invisible">",
        "          <span class="min-w-0 flex-1 break-words">Any role",
        "        <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="r-0" role="option">",
        "          <svg aria-hidden="true" class="lucide lucide-check h-4 w-4 invisible">",
        "          <span class="min-w-0 flex-1 break-words">Committee 1",
        "        <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="r-1" role="option">",
        "          <svg aria-hidden="true" class="lucide lucide-check h-4 w-4 invisible">",
        "          <span class="min-w-0 flex-1 break-words">Committee 2",
        "        <div aria-disabled="false" aria-selected="true" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="true" data-value="r-2" role="option">",
        "          <svg aria-hidden="true" class="lucide lucide-check h-4 w-4">",
        "          <span class="min-w-0 flex-1 break-words">Committee 3",
        "            <span class="sr-only">(selected)",
        "        <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="r-3" role="option">",
        "          <svg aria-hidden="true" class="lucide lucide-check h-4 w-4 invisible">",
        "          <span class="min-w-0 flex-1 break-words">Committee 4",
        "        <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="r-4" role="option">",
        "          <svg aria-hidden="true" class="lucide lucide-check h-4 w-4 invisible">",
        "          <span class="min-w-0 flex-1 break-words">Committee 5",
        "        <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="r-5" role="option">",
        "          <svg aria-hidden="true" class="lucide lucide-check h-4 w-4 invisible">",
        "          <span class="min-w-0 flex-1 break-words">Committee 6",
        "        <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="r-6" role="option">",
        "          <svg aria-hidden="true" class="lucide lucide-check h-4 w-4 invisible">",
        "          <span class="min-w-0 flex-1 break-words">Committee 7",
        "        <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="r-7" role="option">",
        "          <svg aria-hidden="true" class="lucide lucide-check h-4 w-4 invisible">",
        "          <span class="min-w-0 flex-1 break-words">Committee 8",
        "        <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="r-8" role="option">",
        "          <svg aria-hidden="true" class="lucide lucide-check h-4 w-4 invisible">",
        "          <span class="min-w-0 flex-1 break-words">Committee 9",
      ]
    `);
    await user.type(screen.getByRole("combobox"), "zz ");
    expect(markupLines(screen.getByRole("status"))).toMatchInlineSnapshot(`
      [
        "<p class="px-2 py-3 text-sm text-muted" role="status">Nothing matches “zz”.",
      ]
    `);
  });
});

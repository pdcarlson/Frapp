import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { markupLines } from "@/tests/stable-markup";
import {
  ChannelAccessField,
  channelAccessOptionsState,
  type ChannelAccessOption,
  type ChannelAccessOptionsState,
} from "./channel-access-field";

/**
 * The one reading of the options read that the channel page and the create
 * sheet both pass to `ChannelAccessField`.
 */
describe("channelAccessOptionsState", () => {
  const base = { isError: false, isPending: false, fetchStatus: "idle" };

  it("is ready once the options are cached, whatever the fetch is doing", () => {
    expect(channelAccessOptionsState({ ...base, data: [] })).toBe("ready");
    expect(
      channelAccessOptionsState({
        ...base,
        data: [],
        isError: true,
        fetchStatus: "paused",
      }),
    ).toBe("ready");
  });

  it("is loading while an uncached read is in flight", () => {
    expect(
      channelAccessOptionsState({
        ...base,
        data: undefined,
        isPending: true,
        fetchStatus: "fetching",
      }),
    ).toBe("loading");
  });

  it("is error when an uncached read failed", () => {
    expect(
      channelAccessOptionsState({ ...base, data: undefined, isError: true }),
    ).toBe("error");
  });

  it("is error, not loading, when an uncached read paused", () => {
    expect(
      channelAccessOptionsState({
        ...base,
        data: undefined,
        isPending: true,
        fetchStatus: "paused",
      }),
    ).toBe("error");
  });
});

/**
 * The Add menu under a channel's "Who can see" (#5264): pinned markup, so
 * moving it onto the shared `SearchablePicker` can't change a class, a width
 * or a line of copy without failing here.
 */
describe("ChannelAccessField's Add menu", () => {
  const option = (
    entry: string,
    kind: string,
    name: string,
    users: number,
    color: string | null = null,
  ): ChannelAccessOption => ({
    entry,
    kind,
    id: entry,
    name,
    color,
    tier_id: null,
    user_ids: Array.from({ length: users }, (_, i) => `${entry}-u${i}`),
  });
  const OPTIONS = [
    option("role-r-social", "role", "Social Chair", 3, "#ff0000"),
    option("tier-t-exec", "tier", "Exec board", 1),
    option("group-g-2027", "group", "Class of 2027", 12),
    option("role-r-new", "role", "New Member", 0),
  ];

  async function openAdd(props: {
    value?: readonly string[];
    optionsState?: ChannelAccessOptionsState;
  }) {
    const user = userEvent.setup();
    render(
      <ChannelAccessField
        id="see"
        question="see"
        value={props.value ?? []}
        onChange={() => {}}
        options={OPTIONS}
        optionsState={props.optionsState ?? "ready"}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Add to who can see" }),
    );
    return user;
  }

  it("draws the trigger and the grouped list exactly as before", async () => {
    await openAdd({});
    expect(
      markupLines(screen.getByRole("button", { name: "Add to who can see" })),
    ).toMatchInlineSnapshot(`
      [
        "<button aria-expanded="true" aria-haspopup="dialog" aria-label="Add to who can see" class="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 text-caption font-semibold text-muted-foreground hover:border-input hover:text-foreground focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25" data-radix-popper-align="start" data-radix-popper-side="bottom" data-state="open" type="button">Add",
        "  <svg aria-hidden="true" class="lucide lucide-plus h-3 w-3">",
      ]
    `);
    expect(markupLines(screen.getByRole("dialog"))).toMatchInlineSnapshot(`
      [
        "<div class="z-50 rounded-md border border-border bg-popover text-popover-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin] w-max min-w-[16rem] max-w-[min(24rem,calc(100vw-2rem))] p-0" data-align="start" data-side="bottom" data-state="open" role="dialog" style="--radix-popover-content-transform-origin: var(--radix-popper-transform-origin); --radix-popover-content-available-width: var(--radix-popper-available-width); --radix-popover-content-available-height: var(--radix-popper-available-height); --radix-popover-trigger-width: var(--radix-popper-anchor-width); --radix-popover-trigger-height: var(--radix-popper-anchor-height);" tabindex="-1">",
        "  <div class="flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground outline-none" cmdk-root="" tabindex="-1">",
        "    <label cmdk-label="" style="position: absolute; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; border-width: 0px;">Add to who can see",
        "    <div class="flex items-center border-b border-border px-3" cmdk-input-wrapper="">",
        "      <svg aria-hidden="true" class="lucide lucide-search mr-2 h-4 w-4 shrink-0 text-muted">",
        "      <input aria-autocomplete="list" aria-expanded="true" autocomplete="off" autocorrect="off" class="flex w-full rounded-md bg-transparent text-foreground caret-primary outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:text-disabled h-9 py-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base" cmdk-input="" placeholder="Find a tier, role or group" role="combobox" spellcheck="false" type="text" value="">",
        "    <div aria-label="Suggestions" class="overflow-y-auto overflow-x-hidden max-h-72 p-1" cmdk-list="" role="listbox" tabindex="-1">",
        "      <div cmdk-list-sizer="">",
        "        <div class="overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground" cmdk-group="" data-value="Tiers" role="presentation">",
        "          <div aria-hidden="true" cmdk-group-heading="">Tiers",
        "          <div cmdk-group-items="" role="group">",
        "            <div aria-disabled="false" aria-selected="true" class="relative flex cursor-default select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="true" data-value="tier-t-exec" role="option">",
        "              <svg aria-hidden="true" class="lucide lucide-layers lucide-layers-3 h-3 w-3 shrink-0 text-muted-foreground">",
        "              <span class="min-w-0 flex-1 break-words">Exec board",
        "              <span class="shrink-0 text-caption text-muted-foreground">1 person",
        "        <div class="overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground" cmdk-group="" data-value="Roles" role="presentation">",
        "          <div aria-hidden="true" cmdk-group-heading="">Roles",
        "          <div cmdk-group-items="" role="group">",
        "            <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="role-r-social" role="option">",
        "              <span aria-hidden="true" class="h-2 w-2 shrink-0 rounded-full bg-muted-foreground" style="background-color: rgb(255, 0, 0);">",
        "              <span class="min-w-0 flex-1 break-words">Social Chair",
        "              <span class="shrink-0 text-caption text-muted-foreground">3 people",
        "            <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="role-r-new" role="option">",
        "              <span aria-hidden="true" class="h-2 w-2 shrink-0 rounded-full bg-muted-foreground">",
        "              <span class="min-w-0 flex-1 break-words">New Member",
        "              <span class="shrink-0 text-caption text-muted-foreground">0 people",
        "        <div class="overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground" cmdk-group="" data-value="Groups" role="presentation">",
        "          <div aria-hidden="true" cmdk-group-heading="">Groups",
        "          <div cmdk-group-items="" role="group">",
        "            <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="group-g-2027" role="option">",
        "              <span aria-hidden="true" class="h-2 w-2 shrink-0 rounded-full bg-muted-foreground">",
        "              <span class="min-w-0 flex-1 break-words">Class of 2027",
        "              <span class="shrink-0 text-caption text-muted-foreground">12 people",
      ]
    `);
  });

  it("says it is loading, as before", async () => {
    await openAdd({ optionsState: "loading" });
    expect(markupLines(screen.getByRole("dialog")).slice(1))
      .toMatchInlineSnapshot(`
      [
        "  <div class="flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground outline-none" cmdk-root="" tabindex="-1">",
        "    <label cmdk-label="" style="position: absolute; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; border-width: 0px;">Add to who can see",
        "    <div class="flex items-center border-b border-border px-3" cmdk-input-wrapper="">",
        "      <svg aria-hidden="true" class="lucide lucide-search mr-2 h-4 w-4 shrink-0 text-muted">",
        "      <input aria-autocomplete="list" aria-expanded="true" autocomplete="off" autocorrect="off" class="flex w-full rounded-md bg-transparent text-foreground caret-primary outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:text-disabled h-9 py-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base" cmdk-input="" placeholder="Find a tier, role or group" role="combobox" spellcheck="false" type="text" value="">",
        "    <div aria-label="Suggestions" class="overflow-y-auto overflow-x-hidden max-h-72 p-1" cmdk-list="" role="listbox" tabindex="-1">",
        "      <div cmdk-list-sizer="">",
        "        <p class="px-2 py-3 text-sm text-muted" role="status">Loading who you can add",
      ]
    `);
  });

  it("says the options couldn't load, as before", async () => {
    await openAdd({ optionsState: "error" });
    expect(markupLines(screen.getByRole("status"))).toMatchInlineSnapshot(`
      [
        "<p class="px-2 py-3 text-sm text-muted" role="status">Couldn't load your chapter's tiers and roles.",
      ]
    `);
  });

  it("says everything is already on the list when nothing is left", async () => {
    await openAdd({
      value: ["role-r-social", "tier-t-exec", "group-g-2027", "role-r-new"],
    });
    expect(markupLines(screen.getByRole("status"))).toMatchInlineSnapshot(`
      [
        "<p class="px-2 py-3 text-sm text-muted" role="status">Everything is already on the list.",
      ]
    `);
  });

  it("says when nothing matches, clears on Escape, then closes", async () => {
    const user = await openAdd({});
    const input = screen.getByPlaceholderText("Find a tier, role or group");
    await user.type(input, "air ");
    expect(markupLines(screen.getByRole("status"))).toMatchInlineSnapshot(`
      [
        "<p class="px-2 py-3 text-sm text-muted" role="status">Nothing matches “air”.",
      ]
    `);
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(4);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("adds the pick and closes", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ChannelAccessField
        id="post"
        question="post"
        value={[]}
        onChange={onChange}
        options={OPTIONS}
        optionsState="ready"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Add to who can post" }),
    );
    await user.type(screen.getByRole("combobox"), "cla");
    await user.click(screen.getByRole("option", { name: /Class of 2027/ }));
    expect(onChange).toHaveBeenCalledWith(["group-g-2027"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

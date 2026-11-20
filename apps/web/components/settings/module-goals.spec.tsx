import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markupLines } from "@/tests/stable-markup";

const state = vi.hoisted(() => ({
  goals: undefined as Record<string, unknown> | undefined,
  rolesPending: false,
  mutate: vi.fn(),
  toast: vi.fn(),
}));

const ROLES = [
  { id: "11111111-1111-4111-8111-111111111111", name: "President" },
  { id: "22222222-2222-4222-8222-222222222222", name: "New Member" },
];

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useChapterGoals: () => ({
    data: state.goals,
    isPending: state.goals === undefined,
    isError: false,
  }),
  useSetChapterGoals: () => ({ mutate: state.mutate, isPending: false }),
  useRoles: () =>
    state.rolesPending
      ? { data: undefined, isPending: true, isError: false }
      : { data: ROLES, isPending: false, isError: false },
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: state.toast }),
}));

const { ModuleGoals } = await import("./module-goals");

const none = { everyone: null, roles: [] };

/**
 * Chapter settings → Service hours → Goals (#1062): a president holding
 * every member to 10 service hours a semester, and new members to 6 study
 * hours a week where everyone else owes 4.
 */
describe("a module page's goals", () => {
  beforeEach(() => {
    state.goals = { points: none, service: none, study: none };
    state.rolesPending = false;
    state.mutate.mockReset();
    state.toast.mockReset();
  });

  it("saves a goal for everyone in minutes, typed in hours", async () => {
    const user = userEvent.setup();
    render(<ModuleGoals metrics={["service", "study"]} canManage />);
    await user.type(screen.getByLabelText("Service hours goal"), "10");
    await user.click(screen.getByRole("button", { name: "Save service goal" }));
    expect(state.mutate).toHaveBeenCalledWith(
      { everyone: 600, roles: [] },
      expect.anything(),
    );
  });

  it("sets a role apart with its own goal", async () => {
    state.goals = {
      points: none,
      service: none,
      study: { everyone: 240, roles: [] },
    };
    const user = userEvent.setup();
    render(<ModuleGoals metrics={["study"]} canManage />);
    expect(screen.getByLabelText("Study hours goal")).toHaveValue("4");
    await user.click(
      screen.getByRole("button", { name: "Different goal for a role" }),
    );
    await user.click(await screen.findByRole("option", { name: "New Member" }));
    await user.type(screen.getByLabelText("New Member"), "6");
    await user.click(screen.getByRole("button", { name: "Save study goal" }));
    expect(state.mutate).toHaveBeenCalledWith(
      {
        everyone: 240,
        roles: [{ role_id: ROLES[1]!.id, target: 360 }],
      },
      expect.anything(),
    );
  });

  it("holds a role left empty to no goal", async () => {
    state.goals = {
      points: none,
      service: { everyone: 600, roles: [] },
      study: none,
    };
    const user = userEvent.setup();
    render(<ModuleGoals metrics={["service"]} canManage />);
    await user.click(
      screen.getByRole("button", { name: "Different goal for a role" }),
    );
    await user.click(await screen.findByRole("option", { name: "President" }));
    await user.click(screen.getByRole("button", { name: "Save service goal" }));
    expect(state.mutate).toHaveBeenCalledWith(
      { everyone: 600, roles: [{ role_id: ROLES[0]!.id, target: null }] },
      expect.anything(),
    );
  });

  it("won't save a role with a number past the limit", async () => {
    const user = userEvent.setup();
    render(<ModuleGoals metrics={["points"]} canManage />);
    await user.click(
      screen.getByRole("button", { name: "Different goal for a role" }),
    );
    await user.click(await screen.findByRole("option", { name: "President" }));
    await user.type(screen.getByLabelText("President"), "99999999");
    await user.click(screen.getByRole("button", { name: "Save points goal" }));
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("waits for the roles before naming a role's goal", () => {
    state.goals = {
      points: { everyone: 60, roles: [{ role_id: ROLES[0]!.id, target: 80 }] },
      service: none,
      study: none,
    };
    state.rolesPending = true;
    render(<ModuleGoals metrics={["points"]} canManage />);
    expect(screen.getByText("Loading goals")).toBeInTheDocument();
    expect(screen.queryByText("Removed role")).toBeNull();
  });

  it("removes a role's own goal", async () => {
    state.goals = {
      points: { everyone: 60, roles: [{ role_id: ROLES[0]!.id, target: 80 }] },
      service: none,
      study: none,
    };
    const user = userEvent.setup();
    render(<ModuleGoals metrics={["points"]} canManage />);
    expect(screen.getByLabelText("President")).toHaveValue("80");
    await user.click(
      screen.getByRole("button", {
        name: "Remove President's own points goal",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save points goal" }));
    expect(state.mutate).toHaveBeenCalledWith(
      { everyone: 60, roles: [] },
      expect.anything(),
    );
  });

  it("finds a role by the start of a word, and says when none matches", async () => {
    const user = userEvent.setup();
    render(<ModuleGoals metrics={["points"]} canManage />);
    await user.click(
      screen.getByRole("button", { name: "Different goal for a role" }),
    );
    const input = screen.getByPlaceholderText("Find a role");
    await user.type(input, "mem");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["New Member"]);
    await user.type(input, "x");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing matches “memx”.",
    );
    expect(markupLines(screen.getByRole("status"))).toMatchInlineSnapshot(`
      [
        "<p class="px-2 py-3 text-sm text-muted" role="status">Nothing matches “memx”.",
      ]
    `);
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("doesn't match the middle of a word", async () => {
    const user = userEvent.setup();
    render(<ModuleGoals metrics={["points"]} canManage />);
    await user.click(
      screen.getByRole("button", { name: "Different goal for a role" }),
    );
    const input = screen.getByPlaceholderText("Find a role");
    await user.type(input, "ember");
    expect(screen.queryByRole("option", { name: "New Member" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing matches “ember”.",
    );
    await user.clear(input);
    await user.type(input, "new mem");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["New Member"]);
  });

  it("draws the role picker exactly as before", async () => {
    const user = userEvent.setup();
    render(<ModuleGoals metrics={["study"]} canManage />);
    const trigger = screen.getByRole("button", {
      name: "Different goal for a role",
    });
    await user.click(trigger);
    expect(markupLines(trigger)).toMatchInlineSnapshot(`
      [
        "<button aria-expanded="true" aria-haspopup="dialog" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground hover:border-input hover:text-foreground disabled:pointer-events-none focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25" data-radix-popper-align="start" data-radix-popper-side="bottom" data-state="open" type="button">Different goal for a role",
        "  <svg aria-hidden="true" class="lucide lucide-plus h-3.5 w-3.5">",
      ]
    `);
    expect(markupLines(screen.getByRole("dialog"))).toMatchInlineSnapshot(`
      [
        "<div class="z-50 rounded-md border border-border bg-popover text-popover-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-popover-content-transform-origin) w-max min-w-[14rem] max-w-[min(22rem,calc(100vw-2rem))] p-0" data-align="start" data-side="bottom" data-state="open" role="dialog" style="--radix-popover-content-transform-origin: var(--radix-popper-transform-origin); --radix-popover-content-available-width: var(--radix-popper-available-width); --radix-popover-content-available-height: var(--radix-popper-available-height); --radix-popover-trigger-width: var(--radix-popper-anchor-width); --radix-popover-trigger-height: var(--radix-popper-anchor-height);" tabindex="-1">",
        "  <div class="flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground outline-none" cmdk-root="" tabindex="-1">",
        "    <label cmdk-label="" style="position: absolute; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; border-width: 0px;">Role for a different study hours goal",
        "    <div class="flex items-center border-b border-border px-3" cmdk-input-wrapper="">",
        "      <svg aria-hidden="true" class="lucide lucide-search mr-2 h-4 w-4 shrink-0 text-muted">",
        "      <input aria-autocomplete="list" aria-expanded="true" autocomplete="off" autocorrect="off" class="flex w-full rounded-md bg-transparent text-foreground caret-primary outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:text-disabled h-9 py-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base" cmdk-input="" placeholder="Find a role" role="combobox" spellcheck="false" type="text" value="">",
        "    <div aria-label="Suggestions" class="overflow-y-auto overflow-x-hidden max-h-72 p-1" cmdk-list="" role="listbox" tabindex="-1">",
        "      <div cmdk-list-sizer="">",
        "        <div aria-disabled="false" aria-selected="true" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="true" data-value="11111111-1111-4111-8111-111111111111" role="option">",
        "          <span class="min-w-0 flex-1 break-words">President",
        "        <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default gap-2 select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="22222222-2222-4222-8222-222222222222" role="option">",
        "          <span class="min-w-0 flex-1 break-words">New Member",
      ]
    `);
  });

  it("shows the goals read-only to an officer who can't change them", () => {
    state.goals = {
      points: { everyone: 60, roles: [] },
      service: none,
      study: none,
    };
    render(<ModuleGoals metrics={["points"]} canManage={false} />);
    const section =
      screen.getByText("Goals").closest("section") ?? document.body;
    expect(
      within(section as HTMLElement).getByLabelText("Points goal"),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Different goal for a role" }),
    ).toBeNull();
    expect(
      screen.getByText("Your role can't change these."),
    ).toBeInTheDocument();
  });
});

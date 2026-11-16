import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markupLines } from "@/tests/stable-markup";

const state = vi.hoisted(() => ({ toggle: vi.fn() }));

const tier = (id: string, name: string, position: number) => ({
  id,
  name,
  position,
  permissions: [] as string[],
  mentionable: true,
});
const role = (
  id: string,
  name: string,
  color: string | null,
  order: number,
) => ({
  id,
  name,
  color,
  permissions: [] as string[],
  is_system: false,
  system_key: null,
  display_order: order,
  mentionable: true,
  tier_id: null,
  permission_overrides: {},
});

vi.mock("@/components/roles/use-roles-data", () => ({
  useRolesData: () => ({
    rolesQuery: { isPending: false, isError: false },
    tiersQuery: { isPending: false, isError: false },
    roles: [
      role("r-social", "Social Chair", "#ff0000", 1),
      role("r-new", "New Member", null, 2),
    ],
    tiers: [tier("t-exec", "Exec board", 1), tier("t-chairs", "Chairs", 2)],
    reach: { wildcard: true, known: true, rank: 0, held: new Set<string>() },
    words: {
      Singular: "Tier",
      Plural: "Tiers",
      singular: "tier",
      plural: "tiers",
    },
  }),
}));

vi.mock("@/components/roles/use-role-permission-toggle", () => {
  const toggle = () => ({
    permissionsOf: (holder: { permissions: string[] }) => holder.permissions,
    pending: null,
    toggle: state.toggle,
  });
  return { useRolePermissionToggle: toggle, useTierPermissionToggle: toggle };
});

vi.mock("@/components/settings/settings-modules", () => ({
  modulePermissions: () => [
    {
      permission: "events:create",
      label: "Create events",
      description: "Put an event on the calendar.",
    },
  ],
}));

const { ModuleWhoCan } = await import("./module-who-can");

async function openAdd() {
  const user = userEvent.setup();
  render(<ModuleWhoCan moduleKey="events" moduleLabel="Events" canEdit />);
  await user.click(
    screen.getByRole("button", { name: "Add to Create events" }),
  );
  return user;
}

/**
 * Chapter settings → Events → Who can (#4073): an officer granting "Create
 * events" to a tier or a role from the "Add" picker, which shares its shell
 * with Goals' "Different goal for a role" (#4608).
 */
describe("a module page's Who can picker", () => {
  beforeEach(() => state.toggle.mockReset());

  it("lists the tiers under the chapter's word, then the roles", async () => {
    await openAdd();
    const groups = screen.getAllByRole("group");
    expect(groups.map((group) => group.parentElement?.textContent)).toEqual([
      "TiersExec boardChairs",
      "RolesSocial ChairNew Member",
    ]);
  });

  it("filters by the start of a word", async () => {
    const user = await openAdd();
    await user.type(screen.getByPlaceholderText("Find a tier or role"), "cha");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Chairs", "Social Chair"]);
  });

  it("says when nothing matches", async () => {
    const user = await openAdd();
    await user.type(screen.getByPlaceholderText("Find a tier or role"), "zz ");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing matches “zz”.",
    );
  });

  it("clears the search on Escape before it closes", async () => {
    const user = await openAdd();
    const input = screen.getByPlaceholderText("Find a tier or role");
    await user.type(input, "exec");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(screen.getByRole("option", { name: "Chairs" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("grants the pick and closes", async () => {
    const user = await openAdd();
    await user.click(screen.getByRole("option", { name: "Social Chair" }));
    expect(state.toggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r-social" }),
      "events:create",
      false,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("draws the picker exactly as before", async () => {
    await openAdd();
    expect(
      markupLines(screen.getByRole("button", { name: "Add to Create events" })),
    ).toMatchInlineSnapshot(`
      [
        "<button aria-expanded="true" aria-haspopup="dialog" aria-label="Add to Create events" class="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 text-caption font-semibold text-muted-foreground hover:border-input hover:text-foreground focus-visible:outline-none focus-visible:border-accent-text focus-visible:ring-[3px] focus-visible:ring-ring/25" data-radix-popper-align="end" data-radix-popper-side="bottom" data-state="open" type="button">Add",
        "  <svg aria-hidden="true" class="lucide lucide-plus h-3 w-3">",
      ]
    `);
    expect(markupLines(screen.getByRole("dialog"))).toMatchInlineSnapshot(`
      [
        "<div class="z-50 rounded-md border border-border bg-popover text-popover-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin] w-max min-w-[14rem] max-w-[min(22rem,calc(100vw-2rem))] p-0" data-align="end" data-side="bottom" data-state="open" role="dialog" style="--radix-popover-content-transform-origin: var(--radix-popper-transform-origin); --radix-popover-content-available-width: var(--radix-popper-available-width); --radix-popover-content-available-height: var(--radix-popper-available-height); --radix-popover-trigger-width: var(--radix-popper-anchor-width); --radix-popover-trigger-height: var(--radix-popper-anchor-height);" tabindex="-1">",
        "  <div class="flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground outline-none" cmdk-root="" tabindex="-1">",
        "    <label cmdk-label="" style="position: absolute; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; border-width: 0px;">Who to add to Create events",
        "    <div class="flex items-center border-b border-border px-3" cmdk-input-wrapper="">",
        "      <svg aria-hidden="true" class="lucide lucide-search mr-2 h-4 w-4 shrink-0 text-muted">",
        "      <input aria-autocomplete="list" aria-expanded="true" autocomplete="off" autocorrect="off" class="flex w-full rounded-md bg-transparent text-foreground caret-primary outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:text-disabled h-9 py-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base" cmdk-input="" placeholder="Find a tier or role" role="combobox" spellcheck="false" type="text" value="">",
        "    <div aria-label="Suggestions" class="overflow-y-auto overflow-x-hidden max-h-72 p-1" cmdk-list="" role="listbox" tabindex="-1">",
        "      <div cmdk-list-sizer="">",
        "        <div class="overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground" cmdk-group="" data-value="Tiers" role="presentation">",
        "          <div aria-hidden="true" cmdk-group-heading="">Tiers",
        "          <div cmdk-group-items="" role="group">",
        "            <div aria-disabled="false" aria-selected="true" class="relative flex cursor-default select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="true" data-value="tier-t-exec" role="option">",
        "              <span class="min-w-0 flex-1 break-words">Exec board",
        "            <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="tier-t-chairs" role="option">",
        "              <span class="min-w-0 flex-1 break-words">Chairs",
        "        <div class="overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground" cmdk-group="" data-value="Roles" role="presentation">",
        "          <div aria-hidden="true" cmdk-group-heading="">Roles",
        "          <div cmdk-group-items="" role="group">",
        "            <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="role-r-social" role="option">",
        "              <span aria-hidden="true" class="h-2 w-2 shrink-0 rounded-full bg-muted-foreground" style="background-color: rgb(255, 0, 0);">",
        "              <span class="min-w-0 flex-1 break-words">Social Chair",
        "            <div aria-disabled="false" aria-selected="false" class="relative flex cursor-default select-none items-center rounded-xs px-2 py-1.5 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-card-hover data-[selected=true]:text-foreground data-[disabled=true]:text-disabled [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 min-h-8 gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base" cmdk-item="" data-disabled="false" data-selected="false" data-value="role-r-new" role="option">",
        "              <span aria-hidden="true" class="h-2 w-2 shrink-0 rounded-full bg-muted-foreground">",
        "              <span class="min-w-0 flex-1 break-words">New Member",
      ]
    `);
  });
});

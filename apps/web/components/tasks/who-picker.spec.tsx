// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TaskWho } from "@repo/validation";
import { WhoPicker, type WhoPickerAllow } from "./who-picker";

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentUser: () => ({ data: { id: "u-paul" } }),
  useMembers: () => ({
    data: [
      { user_id: "u-paul", display_name: "Paul Carlson", role_ids: ["role-pres"] },
      { user_id: "u-sam", display_name: "Sam Ortiz", role_ids: ["role-rush"] },
      { user_id: "u-alex", display_name: "Alex Kim", role_ids: ["role-rush"] },
      { user_id: "u-old", display_name: "Old Timer", role_ids: [], is_alumni: true },
    ],
    isError: false,
    refetch: vi.fn(),
  }),
  useRoles: () => ({
    data: [
      { id: "role-member", name: "Member", system_key: "MEMBER", display_order: 9 },
      { id: "role-pres", name: "President", tier_id: "tier-exec", display_order: 1 },
      { id: "role-hist", name: "Historian", tier_id: "tier-exec", display_order: 2 },
      { id: "role-rush", name: "Recruitment Committee", tier_id: "tier-chairs", display_order: 3 },
    ],
  }),
  useRoleTiers: () => ({
    data: [
      { id: "tier-exec", name: "Exec board", position: 1 },
      { id: "tier-chairs", name: "Chairs", position: 2 },
    ],
  }),
  useGroups: () => ({ data: [] }),
  useMemberDisplayNames: () => ({
    avatarTintFor: () => null,
    nameFor: () => null,
    avatarFor: () => null,
  }),
}));

function Harness({
  allow = "any",
  initial = null,
  onChange = () => undefined,
}: {
  allow?: WhoPickerAllow;
  initial?: TaskWho | null;
  onChange?: (who: TaskWho | null) => void;
}) {
  const [value, setValue] = useState<TaskWho | null>(initial);
  return (
    <WhoPicker
      allow={allow}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const openPicker = async () =>
  userEvent.click(screen.getByRole("button", { name: /^who/i }));

describe("WhoPicker", () => {
  it("puts the chapter first, then active members with the viewer marked", async () => {
    render(<Harness />);
    await openPicker();

    expect(screen.getByRole("textbox", { name: "Search people, roles and groups" })).toHaveFocus();
    const people = screen.getByRole("list", { name: "People" });
    const rows = within(people).getAllByRole("checkbox");
    expect(rows[0]).toHaveAccessibleName(/Everyone in the chapter\s*3/);
    expect(rows[1]).toHaveAccessibleName(/Paul Carlson\s*you/);
    expect(within(people).queryByRole("checkbox", { name: /Old Timer/ })).toBeNull();
  });

  it("ticks people, then offers the mode switch with its hint", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await openPicker();

    await userEvent.click(screen.getByRole("checkbox", { name: /Sam Ortiz/ }));
    expect(screen.queryByRole("radiogroup", { name: "How it's given" })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: /Alex Kim/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "each",
      target: { kind: "people", userIds: ["u-sam", "u-alex"] },
    });
    expect(screen.getByRole("radio", { name: "Each does it" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(screen.getByRole("radio", { name: "One claims it" }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "someone",
      target: { kind: "people", userIds: ["u-sam", "u-alex"] },
    });
  });

  it("keeps the mode going down to one person and back up", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await openPicker();

    await userEvent.click(screen.getByRole("checkbox", { name: /Sam Ortiz/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Alex Kim/ }));
    await userEvent.click(screen.getByRole("radio", { name: "One claims it" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Alex Kim/ }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "person", userId: "u-sam" });
    expect(screen.queryByRole("radiogroup", { name: "How it's given" })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: /Paul Carlson/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "someone",
      target: { kind: "people", userIds: ["u-sam", "u-paul"] },
    });
  });

  it("narrows from the chapter to a role, keeping the mode", async () => {
    const onChange = vi.fn();
    render(
      <Harness
        onChange={onChange}
        initial={{ kind: "someone", target: { kind: "chapter" } }}
      />,
    );
    await openPicker();
    await userEvent.click(screen.getByRole("radio", { name: "Roles and groups" }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Recruitment Committee/ }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "someone",
      target: { kind: "role", id: "role-rush" },
    });
  });

  it("groups roles under their tiers, all open in a chapter with few roles", async () => {
    render(
      <Harness initial={{ kind: "each", target: { kind: "role", id: "role-rush" } }} />,
    );
    await openPicker();

    // A role pick opens on Roles and groups.
    expect(screen.getByRole("radio", { name: "Roles and groups" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("button", { name: /^Exec board/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /^Chairs/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("checkbox", { name: /Recruitment Committee/ }),
    ).toHaveAttribute("aria-checked", "true");
    // The chapter row heads this tab too.
    expect(screen.getByRole("checkbox", { name: /Everyone in the chapter/ })).toBeInTheDocument();
    expect(screen.getByText("Recruitment Committee · 2 members")).toBeInTheDocument();
  });

  it("picks a whole tier from its own row, first under its heading (#5473)", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await openPicker();
    await userEvent.click(screen.getByRole("radio", { name: "Roles and groups" }));

    const list = screen.getByRole("list", { name: "Exec board" });
    const first = within(list).getAllByRole("checkbox")[0]!;
    expect(first).toHaveAccessibleName(/^Everyone in Exec board/);
    await userEvent.click(first);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ kind: "tier" }),
      }),
    );
  });

  it("shows an empty role greyed, as Nobody yet, and won't pick it", async () => {
    render(<Harness />);
    await openPicker();
    await userEvent.click(screen.getByRole("radio", { name: "Roles and groups" }));

    const historian = screen.getByRole("checkbox", { name: /Historian/ });
    expect(historian).toBeDisabled();
    expect(historian).toHaveAccessibleName(/Nobody yet/);
    expect(screen.queryByRole("button", { name: "Show who's in Historian" })).toBeNull();
  });

  it("narrows a role to some of its members from inside it", async () => {
    const onChange = vi.fn();
    render(
      <Harness
        onChange={onChange}
        initial={{ kind: "each", target: { kind: "role", id: "role-rush" } }}
      />,
    );
    await openPicker();
    await userEvent.click(
      screen.getByRole("button", { name: "Show who's in Recruitment Committee" }),
    );
    const inside = screen.getByRole("list", { name: "Who's in Recruitment Committee" });
    await userEvent.click(within(inside).getByRole("checkbox", { name: /Alex Kim/ }));

    expect(onChange).toHaveBeenLastCalledWith({ kind: "person", userId: "u-sam" });
    expect(
      screen.getByRole("checkbox", { name: /Recruitment Committee/ }),
    ).toHaveAttribute("aria-checked", "mixed");
  });

  it("searches people, roles and groups together", async () => {
    render(<Harness />);
    await openPicker();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search people, roles and groups" }),
      "rec",
    );
    const matches = screen.getByRole("list", { name: "Matches" });
    expect(
      within(matches).getByRole("checkbox", { name: /Recruitment Committee/ }),
    ).toBeInTheDocument();
    expect(within(matches).queryByRole("checkbox", { name: /Sam Ortiz/ })).toBeNull();
  });

  it("is one person only, closing on the pick, when it allows a person", async () => {
    const onChange = vi.fn();
    render(<Harness allow="person" onChange={onChange} />);
    await openPicker();

    expect(screen.getByRole("textbox", { name: "Search people" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Roles and groups" })).toBeNull();
    expect(screen.queryByRole("radio", { name: /Everyone in the chapter/ })).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: /Sam Ortiz/ }));

    expect(onChange).toHaveBeenCalledWith({ kind: "person", userId: "u-sam" });
    expect(screen.queryByRole("textbox", { name: "Search people" })).toBeNull();
    expect(screen.getByRole("button", { name: "Who: Sam Ortiz" })).toBeInTheDocument();
  });
});

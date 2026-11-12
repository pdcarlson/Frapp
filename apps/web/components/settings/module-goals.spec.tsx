import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

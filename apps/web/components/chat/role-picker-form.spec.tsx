import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyRolePickerDraft, RolePickerForm } from "./role-picker-form";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const h = vi.hoisted(() => ({ roles: [] as Record<string, unknown>[] }));
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRoles: () => ({
      data: h.roles,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    }),
  };
});

function role(id: string, name: string, selfAssignable: boolean) {
  return { id, name, permissions: [], self_assignable: selfAssignable };
}

beforeEach(() => {
  h.roles = [
    role("r-vg", "Video games", true),
    role("r-pres", "President", false),
    role("r-im", "Intramurals", true),
  ];
});

function renderForm(onPost = vi.fn(async () => ({ ok: true as const }))) {
  const onDone = vi.fn();
  render(
    <RolePickerForm
      initialDraft={emptyRolePickerDraft()}
      onPost={onPost}
      onDone={onDone}
      onDiscard={vi.fn()}
    />,
  );
  return { onPost, onDone };
}

describe("RolePickerForm (#4958)", () => {
  it("lists only Non-chapter business roles, by name", () => {
    renderForm();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((box) => box.closest("label")?.textContent)).toEqual([
      "Intramurals",
      "Video games",
    ]);
  });

  it("disables Post until a role is picked, then posts the built card", async () => {
    const user = userEvent.setup();
    const { onPost, onDone } = renderForm();
    const post = screen.getByRole("button", { name: "Post role picker" });
    expect(post).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Video games" }));
    await user.click(screen.getByRole("checkbox", { name: "Intramurals" }));
    expect(post).toBeEnabled();
    await user.click(post);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onPost).toHaveBeenCalledWith({
      content: "Pick your roles",
      payload: { title: "Pick your roles", role_ids: ["r-vg", "r-im"] },
    });
  });

  it("posts the typed title", async () => {
    const user = userEvent.setup();
    const { onPost } = renderForm();
    await user.type(screen.getByPlaceholderText("Pick your roles"), "Teams");
    await user.click(screen.getByRole("checkbox", { name: "Intramurals" }));
    await user.click(screen.getByRole("button", { name: "Post role picker" }));
    await waitFor(() =>
      expect(onPost).toHaveBeenCalledWith({
        content: "Teams",
        payload: { title: "Teams", role_ids: ["r-im"] },
      }),
    );
  });

  it("points to Roles when no role is marked", () => {
    h.roles = [role("r-pres", "President", false)];
    renderForm();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Roles" })).toHaveAttribute(
      "href",
      "/roles",
    );
    expect(
      screen.getByRole("button", { name: "Post role picker" }),
    ).toBeDisabled();
  });
});

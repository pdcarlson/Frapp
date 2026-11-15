import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  RolePickerCard,
  ROLE_PICKER_CLOSED_CAPTION,
  ROLE_PICKER_GONE_COPY,
} from "./role-picker-card";

const h = vi.hoisted(() => ({
  pickable: [] as {
    id: string;
    name: string;
    held: boolean;
    joinable: boolean;
  }[],
  chapterRoles: [] as { id: string; name: string }[],
  mutateAsync: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usePickableRoles: () => ({
      roles: h.pickable,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useRoles: () => ({ data: h.chapterRoles }),
    useSetPickedRole: () => ({ mutateAsync: h.mutateAsync }),
  };
});

function card(payload: unknown): ChatMessage {
  return {
    id: "m1",
    channel_id: "c1",
    sender_id: "u9",
    _status: "confirmed",
    is_deleted: false,
    content: "Pick your roles",
    kind: "role_picker",
    payload,
    actions: [],
  } as unknown as ChatMessage;
}

const PAYLOAD = { title: "Fall interests", role_ids: ["r1", "r2", "r3", "r4"] };

beforeEach(() => {
  h.mutateAsync.mockReset();
  h.pickable = [
    { id: "r1", name: "Intramurals", held: false, joinable: true },
    { id: "r2", name: "Study group", held: true, joinable: true },
  ];
  // r3 is still in the chapter but unmarked; r4 was deleted.
  h.chapterRoles = [
    { id: "r1", name: "Intramurals" },
    { id: "r2", name: "Study group" },
    { id: "r3", name: "Video games" },
  ];
});

describe("RolePickerCard (#4958)", () => {
  it("draws Join, Leave and closed rows, and leaves a deleted role out", () => {
    render(<RolePickerCard message={card(PAYLOAD)} isConfirmed />);
    expect(screen.getByText("Fall interests")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Join Intramurals" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Leave Study group" }),
    ).toBeEnabled();
    expect(screen.getByText("Video games")).toBeInTheDocument();
    expect(screen.getByText(ROLE_PICKER_CLOSED_CAPTION)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Video games/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("joins and leaves through useSetPickedRole", async () => {
    const user = userEvent.setup();
    h.mutateAsync.mockResolvedValue({});
    render(<RolePickerCard message={card(PAYLOAD)} isConfirmed />);
    await user.click(screen.getByRole("button", { name: "Join Intramurals" }));
    expect(h.mutateAsync).toHaveBeenCalledWith({ id: "r1", join: true });
    await user.click(screen.getByRole("button", { name: "Leave Study group" }));
    expect(h.mutateAsync).toHaveBeenLastCalledWith({ id: "r2", join: false });
  });

  it("takes one tap at a time, and says under the row when one fails", async () => {
    const user = userEvent.setup();
    let reject: (error: unknown) => void = () => {};
    h.mutateAsync.mockReturnValue(
      new Promise((_, no) => {
        reject = no;
      }),
    );
    render(<RolePickerCard message={card(PAYLOAD)} isConfirmed />);
    await user.click(screen.getByRole("button", { name: "Join Intramurals" }));
    expect(
      screen.getByRole("button", { name: "Leave Study group" }),
    ).toBeDisabled();
    reject(new Error("boom"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Leave Study group" }),
      ).toBeEnabled(),
    );
  });

  it("takes no taps on a card still sending", () => {
    render(<RolePickerCard message={card(PAYLOAD)} isConfirmed={false} />);
    expect(
      screen.getByRole("button", { name: "Join Intramurals" }),
    ).toBeDisabled();
  });

  it("says the roles are gone when every one was deleted", () => {
    render(
      <RolePickerCard
        message={card({ title: "Old", role_ids: ["gone"] })}
        isConfirmed
      />,
    );
    expect(screen.getByText(ROLE_PICKER_GONE_COPY)).toBeInTheDocument();
  });

  it("draws an unreadable payload as a malformed line", () => {
    render(<RolePickerCard message={card({ title: 3 })} isConfirmed />);
    expect(screen.getByText(/Malformed role picker/)).toBeInTheDocument();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const { openChannel, toast, mutateAsync, blockList, roster } = vi.hoisted(() => ({
  openChannel: vi.fn(),
  roster: {
    current: {
      data: undefined as unknown,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    },
  },
  toast: vi.fn(),
  mutateAsync: vi.fn(),
  blockList: {
    current: {
      ids: new Set<string>(["blocked"]) as ReadonlySet<string>,
      status: "ready" as "ready" | "loading" | "unavailable",
      isRetrying: false,
      isPaused: false,
      retry: vi.fn(),
    },
  },
}));

const VIEWER = "viewer";
const ROSTER = [
  { user_id: VIEWER, display_name: "Shawn Klein" },
  { user_id: "paul", display_name: "Paul Carlson" },
  { user_id: "pauline", display_name: "Pauline Park" },
  { user_id: "winston", display_name: "Winston Lee" },
  { user_id: "blocked", display_name: "Paula Blocked" },
];
const NAMES = Object.fromEntries(
  ROSTER.map((row) => [row.user_id, row.display_name]),
);
const CHANNELS = [
  { id: "general", name: "general", type: "PUBLIC" },
  {
    id: "dm-paul",
    // Blank, as a generated name resolves: the row reads the other member.
    name: "",
    type: "DM",
    member_ids: [VIEWER, "paul"],
  },
  {
    id: "dm-winston",
    name: "",
    type: "DM",
    member_ids: [VIEWER, "winston"],
  },
  // Hidden by the viewer: listed nowhere as a conversation, so Pauline is
  // offered as a member, and picking her reopens it through the POST.
  {
    id: "dm-pauline",
    name: "",
    type: "DM",
    member_ids: [VIEWER, "pauline"],
    hidden: true,
  },
];

vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@repo/hooks", async () => ({
  // The matcher and the DM title run for real; only the reads are faked.
  ...(await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks")),
  useViewerUserId: () => VIEWER,
  useChannels: () => ({ data: CHANNELS, isPending: false }),
  useChannelLatestMessages: () => ({
    data: [
      { channel_id: "dm-winston", created_at: "2026-11-12T10:00:00Z" },
      { channel_id: "dm-paul", created_at: "2026-11-11T10:00:00Z" },
    ],
  }),
  useChapterRoster: () => roster.current,
  useMemberDisplayNames: () => ({
    byId: NAMES,
    avatarFor: () => null,
    avatarTintFor: () => null,
  }),
  useBlockedUserIds: () => blockList.current,
  useGetOrCreateDm: () => ({ mutateAsync }),
}));

import { DmSearch } from "./dm-search-dialog";

function Harness({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button type="button">Elsewhere</button>
      <DmSearch
        open={open}
        onOpenChange={setOpen}
        onOpenChannel={openChannel}
      />
    </>
  );
}

const input = () =>
  screen.getByRole("combobox", { name: "Find or start a conversation" });
const options = () =>
  within(screen.getByRole("listbox")).getAllByRole("option");
// Each row's name as drawn, without the avatar's initials.
const optionNames = () =>
  options().map((o) => o.querySelector("span.min-w-0")?.textContent);

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

beforeEach(() => {
  openChannel.mockReset();
  roster.current = {
    data: ROSTER,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
  toast.mockReset();
  mutateAsync.mockReset();
  blockList.current = {
    ids: new Set(["blocked"]),
    status: "ready",
    isRetrying: false,
    isPaused: false,
    retry: vi.fn(),
  };
});

describe("DmSearch", () => {
  it("is a field at the top of the list that opens the search", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Find or start a conversation" }),
    );
    expect(input()).toHaveFocus();
  });

  it("lists recent conversations, newest first, before anything is typed", () => {
    render(<Harness startOpen />);
    expect(optionNames()).toEqual([
      "Winston Lee",
      "Paul Carlson",
    ]);
  });

  it("finds your conversation with Paul, then members you could start one with", () => {
    render(<Harness startOpen />);
    type("paul");
    const shown = optionNames();
    // Paul's DM first; Pauline has none, so she is offered; a blocked member
    // and the viewer never are.
    expect(shown).toEqual(["Paul Carlson", "Pauline Park"]);
    expect(
      screen.getByRole("group", { name: "Conversations" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Start a conversation" }),
    ).toBeInTheDocument();
  });

  it("opens the highlighted conversation on Enter", () => {
    render(<Harness startOpen />);
    type("paul");
    fireEvent.keyDown(input(), { key: "Enter" });
    // Through the shell, as a click on the list's row, never the URL.
    expect(openChannel).toHaveBeenCalledWith("dm-paul");
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("starts a DM with a member who has none, then opens it", async () => {
    mutateAsync.mockResolvedValue({ id: "dm-new" });
    render(<Harness startOpen />);
    type("pauline");
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Pauline Park/ }));
    });
    expect(mutateAsync).toHaveBeenCalledWith({ member_id: "pauline" });
    expect(openChannel).toHaveBeenCalledWith("dm-new");
  });

  it("says so when the DM could not be started, and stays open", async () => {
    mutateAsync.mockRejectedValue(new Error("offline"));
    render(<Harness startOpen />);
    type("pauline");
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Pauline Park/ }));
    });
    expect(openChannel).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not start conversation" }),
    );
    expect(input()).toBeInTheDocument();
  });

  it("holds members back until the block list is read", () => {
    blockList.current = { ...blockList.current, status: "loading" };
    render(<Harness startOpen />);
    type("paul");
    expect(optionNames()).toEqual(["Paul Carlson"]);
    expect(
      screen.getByText(
        "Checking your block list before listing other members.",
      ),
    ).toBeInTheDocument();
  });

  it("offers a retry when the block list could not be read", () => {
    const retry = vi.fn();
    blockList.current = {
      ...blockList.current,
      status: "unavailable",
      retry,
    };
    render(<Harness startOpen />);
    type("paul");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });

  it("says nobody matches", () => {
    render(<Harness startOpen />);
    type("zzz");
    expect(
      screen.getAllByText("No one in your chapter matches “zzz”.").length,
    ).toBeGreaterThan(0);
  });

  it("leaves a hidden DM out of conversations and offers its member instead", () => {
    render(<Harness startOpen />);
    expect(optionNames()).not.toContain("Pauline Park");
    type("pauline");
    expect(optionNames()).toEqual(["Pauline Park"]);
    expect(
      screen.getByRole("group", { name: "Start a conversation" }),
    ).toBeInTheDocument();
  });

  it("moves with the arrow keys, wrapping, and opens the highlighted row", () => {
    render(<Harness startOpen />);
    // Winston (newest), then Paul.
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(openChannel).toHaveBeenCalledWith("dm-paul");
  });

  it("starts a search from a key typed on the field", () => {
    render(<Harness />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Find or start a conversation" }),
      { key: "w" },
    );
    expect(input()).toHaveValue("w");
    expect(optionNames()).toEqual(["Winston Lee"]);
  });

  it("starts one DM however often the member is picked while it starts", async () => {
    let resolve!: (value: unknown) => void;
    mutateAsync.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Harness startOpen />);
    type("pauline");
    const row = screen.getByRole("option", { name: /Pauline Park/ });
    fireEvent.click(row);
    fireEvent.click(row);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ id: "dm-pauline" }));
    expect(openChannel).toHaveBeenCalledTimes(1);
  });

  it("doesn't open a DM that finishes starting after the search closed", async () => {
    let resolve!: (value: unknown) => void;
    mutateAsync.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Harness startOpen />);
    type("pauline");
    fireEvent.click(screen.getByRole("option", { name: /Pauline Park/ }));
    fireEvent.keyDown(input(), { key: "Escape" });
    await act(async () => resolve({ id: "dm-pauline" }));
    expect(openChannel).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("says the members couldn't load, never that nobody matches, and retries", () => {
    const refetch = vi.fn();
    roster.current = {
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch,
    };
    render(<Harness startOpen />);
    type("pauline");
    expect(
      screen.queryByText("No one in your chapter matches “pauline”."),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("listbox")).getByText(
        "Couldn't load your chapter's members, so only your conversations are listed.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("puts focus back on what opened it", async () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            New message
          </button>
          <DmSearch
            open={open}
            onOpenChange={setOpen}
            onOpenChannel={openChannel}
          />
        </>
      );
    }
    render(<Opener />);
    const pencil = screen.getByRole("button", { name: "New message" });
    pencil.focus();
    fireEvent.click(pencil);
    expect(input()).toHaveFocus();
    fireEvent.keyDown(input(), { key: "Escape" });
    // Radix runs the close's focus step on a timeout.
    await waitFor(() => expect(pencil).toHaveFocus());
  });
});

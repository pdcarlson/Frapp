import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "@repo/hooks";

const mockPush = vi.fn();
const mockToast = vi.fn();
const writes = {
  done: vi.fn(),
  hidden: vi.fn(),
  clear: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));
vi.mock("@repo/hooks", () => ({
  useSetActivityLinkState: (state: "done" | "hidden") => ({
    mutateAsync: writes[state],
  }),
  useClearActivityLinkState: () => ({ mutateAsync: writes.clear }),
  useRemoveActivityLink: () => ({ mutateAsync: writes.remove }),
  useRestoreActivityLink: () => ({ mutateAsync: writes.restore }),
}));

const { ActivityLinkRow, useActivityLinkActions } =
  await import("./activity-link-row");

/** The row as the page draws it: the page owns the writes (they outlive the row). */
function Page(props: {
  row: Extract<ActivityRow, { kind: "link" }>;
  canRemove: boolean;
}) {
  const actions = useActivityLinkActions();
  return (
    <ul>
      <ActivityLinkRow {...props} rowClassName="" actions={actions} />
    </ul>
  );
}

const row = (overrides: Record<string, unknown> = {}) =>
  ({
    kind: "link",
    key: "link:l1",
    title: "Google Form",
    detail: "Olive · #rush · Tue 3:00 PM",
    badge: null,
    glyph: "link",
    dateBlock: null,
    link: {
      id: "l1",
      url: "https://forms.gle/abc",
      host: "forms.gle",
      message_id: "m1",
      thread_root_id: null,
      channel_id: "c1",
      channel_name: "rush",
      channel_type: "PUBLIC",
      posted_by: "olive",
      posted_by_name: "Olive",
      posted_at: "2026-11-10T15:00:00.000Z",
      ...overrides,
    },
  }) as Extract<ActivityRow, { kind: "link" }>;

const draw = (canRemove = false, overrides: Record<string, unknown> = {}) =>
  render(<Page row={row(overrides)} canRemove={canRemove} />);

/** The toast's Undo, as the action element the row handed it. */
function undoFromToast(): ReactNode {
  const call = mockToast.mock.calls.at(-1)![0];
  return call.action;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const write of Object.values(writes)) {
    write.mockResolvedValue(undefined);
  }
});

describe("ActivityLinkRow", () => {
  it("opens the link itself in a new tab, with nothing of Frapp's sent along", () => {
    draw();
    const link = screen.getByRole("link", { name: /Google Form/ });
    expect(link).toHaveAttribute("href", "https://forms.gle/abc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("marks it done, says so, and offers Undo that clears the state", async () => {
    const user = userEvent.setup();
    draw();

    await user.click(screen.getByRole("button", { name: "Done: Google Form" }));
    expect(writes.done).toHaveBeenCalledWith("l1");
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Marked done" }),
      ),
    );
    render(<>{undoFromToast()}</>);
    await user.click(screen.getByText("Undo"));
    expect(writes.clear).toHaveBeenCalledWith("l1");
  });

  it("says a failed write instead of dropping it quietly", async () => {
    const user = userEvent.setup();
    writes.done.mockRejectedValueOnce(new Error("nope"));
    draw();
    await user.click(screen.getByRole("button", { name: "Done: Google Form" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: "Couldn't mark the link done",
        }),
      ),
    );
  });

  it("offers Hide and Open in chat to a member, and no Remove", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(
      screen.getByRole("button", { name: "More for Google Form" }),
    );
    const items = (await screen.findAllByRole("menuitem")).map(
      (i) => i.textContent,
    );
    expect(items).toEqual(["Hide: not chapter business", "Open in chat"]);

    await user.click(screen.getByRole("menuitem", { name: /Hide/ }));
    expect(writes.hidden).toHaveBeenCalledWith("l1");
  });

  it("opens a thread reply at its thread's first message, and a channel message at itself", async () => {
    const user = userEvent.setup();
    const { unmount } = draw(false, { thread_root_id: "root-1" });
    await user.click(
      screen.getByRole("button", { name: "More for Google Form" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Open in chat" }),
    );
    expect(mockPush).toHaveBeenLastCalledWith(
      "/chat?channel=c1&message=root-1",
    );
    unmount();

    draw();
    await user.click(
      screen.getByRole("button", { name: "More for Google Form" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Open in chat" }),
    );
    expect(mockPush).toHaveBeenLastCalledWith("/chat?channel=c1&message=m1");
  });

  it("lets an officer remove it for everyone, with Undo that restores it", async () => {
    const user = userEvent.setup();
    draw(true);
    await user.click(
      screen.getByRole("button", { name: "More for Google Form" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Remove for everyone" }),
    );
    expect(writes.remove).toHaveBeenCalledWith("l1");
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Removed from everyone's Activity" }),
      ),
    );
    render(<>{undoFromToast()}</>);
    await user.click(screen.getByText("Undo"));
    expect(writes.restore).toHaveBeenCalledWith("l1");
  });

  it("gives each of two quick Dones its own toast, even when the first answers last", async () => {
    const user = userEvent.setup();
    let answerFirst!: () => void;
    writes.done.mockImplementationOnce(
      () => new Promise<void>((resolve) => (answerFirst = resolve)),
    );
    draw();
    await user.click(screen.getByRole("button", { name: "Done: Google Form" }));
    await user.click(screen.getByRole("button", { name: "Done: Google Form" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    answerFirst();
    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(2));
  });
});

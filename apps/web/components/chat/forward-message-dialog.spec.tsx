import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forwardedFromOf } from "@repo/chat-core/types";
import type { ForwardTarget } from "@repo/chat-core/forward";
import {
  FORWARD_COMMENT_PLACEHOLDER,
  FORWARD_DONE_ANNOUNCEMENT,
  FORWARD_SEARCH_PLACEHOLDER,
  FORWARD_UNAVAILABLE_BODY,
} from "@repo/hooks/forward-destinations";

// Web's Forward to dialog (#4907): the phone picker's conversations (postable
// only, no hidden DMs, no audit log), a search, one pick, an optional
// message, and Send through `useForwardMessage`.

const VIEWER = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";

const CHANNELS = [
  { id: "c-general", name: "general", type: "PUBLIC", can_post: true },
  { id: "c-announce", name: "announcements", type: "PUBLIC", can_post: false },
  { id: "c-audit", name: "audit", type: "PUBLIC", is_audit_log: true },
  { id: "c-random", name: "random", type: "PUBLIC" },
  {
    id: "dm-alice",
    name: `dm-${VIEWER}-${ALICE}`,
    type: "DM",
    member_ids: [VIEWER, ALICE],
  },
  {
    id: "dm-hidden",
    name: `dm-${VIEWER}-x`,
    type: "DM",
    member_ids: [VIEWER, "x"],
    hidden: true,
  },
];

const mocks = vi.hoisted(() => ({
  forward: vi.fn(),
  isPending: false,
  toast: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useChannels: () => ({ data: CHANNELS, isPending: false }),
    useMemberDisplayNames: () => ({ byId: { [ALICE]: "Alice Chen" } }),
    useForwardMessage: () => ({
      mutateAsync: mocks.forward,
      isPending: mocks.isPending,
    }),
  };
});

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const { ForwardMessageDialog } = await import("./forward-message-dialog");

const TARGET: ForwardTarget = {
  messageId: "m1",
  preview: forwardedFromOf({
    message_id: "m1",
    channel_id: "c-general",
    sender_id: ALICE,
    author_name: null,
    content: "pizza at eight",
    gif: null,
    attachment_count: 0,
    created_at: "2026-11-13T18:00:00.000Z",
  })!,
  hidden: null,
};

function open(onClose = vi.fn()) {
  render(
    <ForwardMessageDialog
      target={TARGET}
      nameFor={(id) => (id === ALICE ? "Alice Chen" : null)}
      viewerId={VIEWER}
      onClose={onClose}
    />,
  );
  return onClose;
}

function offered(): string[] {
  return within(screen.getByRole("radiogroup"))
    .getAllByRole("radio")
    .map((radio) => radio.closest("label")!.textContent ?? "");
}

beforeEach(() => {
  mocks.forward.mockReset();
  mocks.toast.mockReset();
  mocks.isPending = false;
});

describe("ForwardMessageDialog (#4907)", () => {
  it("previews the message and offers only where the viewer can post", () => {
    open();
    expect(screen.getByText("Forward to")).toBeInTheDocument();
    expect(screen.getByText("pizza at eight")).toBeInTheDocument();
    expect(offered()).toEqual(["#general", "#random", "Alice Chen"]);
  });

  it("narrows the conversations as the member searches", async () => {
    open();
    await userEvent.type(
      screen.getByRole("searchbox", { name: FORWARD_SEARCH_PLACEHOLDER }),
      "ali",
    );
    expect(offered()).toEqual(["Alice Chen"]);
  });

  it("holds Send until a pick, then forwards with the message, says Forwarded and closes", async () => {
    mocks.forward.mockResolvedValue({ id: "m2" });
    const onClose = open();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "#random" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: FORWARD_COMMENT_PLACEHOLDER }),
      "look",
    );
    await userEvent.click(send);
    expect(mocks.forward).toHaveBeenCalledWith({
      messageId: "m1",
      channelId: "c-random",
      content: "look",
      clientMessageId: expect.any(String),
    });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: FORWARD_DONE_ANNOUNCEMENT,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open on a refusal, says why, and retries the same draft under the same key", async () => {
    mocks.forward.mockRejectedValue({ statusCode: 403 });
    const onClose = open();
    await userEvent.click(screen.getByRole("radio", { name: "Alice Chen" }));
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      FORWARD_UNAVAILABLE_BODY,
    );
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    const keys = mocks.forward.mock.calls.map(
      ([input]) => (input as { clientMessageId: string }).clientMessageId,
    );
    expect(keys[1]).toBe(keys[0]);
  });

  it("never sends from Enter in the search", async () => {
    open();
    await userEvent.click(screen.getByRole("radio", { name: "#random" }));
    await userEvent.type(
      screen.getByRole("searchbox", { name: FORWARD_SEARCH_PLACEHOLDER }),
      "ali{Enter}",
    );
    expect(mocks.forward).not.toHaveBeenCalled();
  });

  it("draws a new key once the message changes", async () => {
    mocks.forward.mockRejectedValue({ statusCode: 502 });
    open();
    await userEvent.click(screen.getByRole("radio", { name: "#random" }));
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    await userEvent.type(
      screen.getByRole("textbox", { name: FORWARD_COMMENT_PLACEHOLDER }),
      "!",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    const keys = mocks.forward.mock.calls.map(
      ([input]) => (input as { clientMessageId: string }).clientMessageId,
    );
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("can't be closed while the forward is out", async () => {
    mocks.isPending = true;
    const onClose = open();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});

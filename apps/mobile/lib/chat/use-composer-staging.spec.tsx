/** @vitest-environment jsdom */
import { MemberFacingError } from "@repo/hooks/error-copy";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  emptyCache,
  mergeServerRow,
  selectMessages,
} from "@repo/chat-core/cache";
import type { BlockState } from "@repo/chat-core/blocks";
import { TOMBSTONE_TEXT } from "@repo/chat-core/block-copy";
import { UNAVAILABLE_QUOTE } from "@repo/chat-core/reply-preview";
import type { ChatMessage, RawChatMessage } from "@repo/chat-core/types";
import {
  EDIT_EMPTY_HINT,
  EDITING_MESSAGE_TITLE,
  REPLYING_TO_A_MESSAGE,
  replyContextFor,
  useComposerStaging,
  type ComposerStagingInput,
} from "./use-composer-staging";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const FRIEND = "33333333-3333-4333-8333-333333333333";
const BLOCKED = "22222222-2222-4222-8222-222222222222";

const READY: BlockState = {
  status: "ready",
  ids: new Set([BLOCKED]),
  unblocked: new Set(),
  cleared: new Set(),
};

function row(
  id: string,
  senderId: string,
  overrides: Partial<RawChatMessage> = {},
): ChatMessage {
  const [message] = selectMessages(
    mergeServerRow(emptyCache(), {
      id,
      channel_id: "chan-1",
      sender_id: senderId,
      content: `body ${id}`,
      kind: "text",
      created_at: "2026-09-29T18:00:00.000000+00:00",
      sender_blocked: false,
      ...overrides,
    }),
  );
  return message!;
}

function index(...messages: ChatMessage[]): Map<string, ChatMessage> {
  return new Map(messages.map((message) => [message.id, message]));
}

const nameFor = (id: string) => (id === FRIEND ? "Casey" : null);

function setup(overrides: Partial<ComposerStagingInput> = {}) {
  const input: ComposerStagingInput = {
    channelId: "chan-1",
    viewerId: VIEWER,
    byId: index(
      row("m1", FRIEND),
      row("m2", VIEWER),
      row("r1", FRIEND, {
        reply_to_id: "m1",
      }),
    ),
    nameFor,
    blockState: READY,
    draft: "the draft",
    setDraft: vi.fn(),
    hasAttachments: false,
    send: vi.fn().mockResolvedValue(true),
    sendInFlight: () => false,
    edit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const hook = renderHook(
    (props: ComposerStagingInput) => useComposerStaging(props),
    { initialProps: input },
  );
  return { ...hook, input };
}

describe("useComposerStaging — reply", () => {
  it("stages a reply, shows who it answers, and sends it with the parent id", () => {
    const { result, input } = setup();
    act(() => result.current.startReply("m1"));
    expect(result.current.context).toMatchObject({
      kind: "reply",
      title: "Replying to Casey",
      preview: "body m1",
    });

    act(() => result.current.submit());
    expect(input.send).toHaveBeenCalledWith("the draft", { replyToId: "m1" });
    // Cleared as the send goes out, so it can't ride the next message.
    expect(result.current.context).toBeNull();
  });

  it("replies to a reply's root, not the reply", () => {
    const { result, input } = setup();
    act(() => result.current.startReply("r1"));
    act(() => result.current.submit());
    expect(input.send).toHaveBeenCalledWith("the draft", { replyToId: "m1" });
  });

  it("keeps the reply staged when the send didn't take it", async () => {
    const send = vi.fn().mockResolvedValue(false);
    const { result } = setup({ send });
    act(() => result.current.startReply("m1"));
    await act(async () => {
      result.current.submit();
      await Promise.resolve();
    });
    expect(result.current.context).toMatchObject({
      kind: "reply",
      title: "Replying to Casey",
    });
  });

  it("sends a reply once on a double tap, and doesn't put back the reply it sent", async () => {
    let settle!: (queued: boolean) => void;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => (settle = resolve)),
      )
      .mockResolvedValue(false);
    const { result } = setup({ send });
    act(() => result.current.startReply("m1"));
    await act(async () => {
      // One render: both taps see the same staged reply.
      result.current.submit();
      result.current.submit();
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.context).toBeNull();
    await act(async () => {
      settle(true);
      await Promise.resolve();
    });
    expect(result.current.context).toBeNull();
  });

  it("puts a refused reply back only if nothing newer was staged meanwhile", async () => {
    let refuse!: (queued: boolean) => void;
    const send = vi.fn(
      () => new Promise<boolean>((resolve) => (refuse = resolve)),
    );
    const byId = index(row("m1", FRIEND), row("m3", FRIEND));
    const { result } = setup({ send, byId });
    act(() => result.current.startReply("m1"));
    act(() => result.current.submit());
    act(() => result.current.startReply("m3"));
    await act(async () => {
      refuse(false);
      await Promise.resolve();
    });
    act(() => result.current.submit());
    expect(send).toHaveBeenLastCalledWith("the draft", { replyToId: "m3" });
  });

  it("sends an ordinary message with no reply target", () => {
    const { result, input } = setup();
    act(() => result.current.submit());
    expect(input.send).toHaveBeenCalledWith("the draft", { replyToId: null });
  });

  it("belongs to the channel it was staged in", () => {
    const { result, rerender, input } = setup();
    act(() => result.current.startReply("m1"));
    rerender({ ...input, channelId: "chan-2" });
    expect(result.current.context).toBeNull();
    act(() => result.current.submit());
    expect(input.send).toHaveBeenLastCalledWith("the draft", {
      replyToId: null,
    });
    rerender({ ...input, channelId: "chan-1" });
    expect(result.current.context?.kind).toBe("reply");
  });

  it("can be cancelled", () => {
    const { result } = setup();
    act(() => result.current.startReply("m1"));
    act(() => result.current.context!.onCancel());
    expect(result.current.context).toBeNull();
  });
});

// The thread follows a send to the newest message through `onSending`, on the
// tap: it must run before the send settles (online, that is after the server
// answers), and only when a message goes out.
describe("useComposerStaging — onSending", () => {
  it("runs on the tap, before the send settles, and not again when it does", async () => {
    let settle!: (queued: boolean) => void;
    const send = vi.fn(
      () => new Promise<boolean>((resolve) => (settle = resolve)),
    );
    const onSending = vi.fn(() => {
      // Before the message is handed over, so the jump comes first.
      expect(send).not.toHaveBeenCalled();
    });
    const { result } = setup({ onSending, send });
    act(() => result.current.submit());
    expect(onSending).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle(true);
      await Promise.resolve();
    });
    expect(onSending).toHaveBeenCalledTimes(1);
  });

  it("does not run for an empty draft, and does for a photo with no caption", () => {
    const onSending = vi.fn();
    const send = vi.fn().mockResolvedValue(true);
    const { result, rerender, input } = setup({ onSending, send, draft: " " });
    act(() => result.current.submit());
    expect(onSending).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    rerender({ ...input, hasAttachments: true });
    act(() => result.current.submit());
    expect(onSending).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(" ", { replyToId: null });
  });

  it("does not run for a resubmit while the staged reply is still in flight", async () => {
    let settle!: (queued: boolean) => void;
    const send = vi.fn(
      () => new Promise<boolean>((resolve) => (settle = resolve)),
    );
    const onSending = vi.fn();
    const { result } = setup({ onSending, send });
    act(() => result.current.startReply("m1"));
    act(() => {
      // One render: the second tap sees the same staged reply, in flight.
      result.current.submit();
      result.current.submit();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(onSending).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle(true);
      await Promise.resolve();
    });
    expect(onSending).toHaveBeenCalledTimes(1);
  });

  // `send` refuses a message while an earlier one is out, and claims that
  // guard as it is called, so `sendInFlight` already holds for a second tap
  // inside the same render.
  function heldSend() {
    let inFlight = false;
    let settle!: (queued: boolean) => void;
    const send = vi.fn(() => {
      inFlight = true;
      return new Promise<boolean>((resolve) => {
        settle = (queued) => {
          inFlight = false;
          resolve(queued);
        };
      });
    });
    return { send, sendInFlight: () => inFlight, settle: (q: boolean) => settle(q) };
  }

  it("does not run while an earlier send is still in flight, and does once it settles", async () => {
    const { send, sendInFlight, settle } = heldSend();
    const onSending = vi.fn();
    const { result, rerender, input } = setup({ onSending, send, sendInFlight });
    act(() => result.current.submit());
    expect(onSending).toHaveBeenCalledTimes(1);

    rerender({ ...input, draft: "the next one" });
    act(() => result.current.submit());
    expect(onSending).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle(true);
      await Promise.resolve();
    });
    act(() => result.current.submit());
    expect(onSending).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("the next one", { replyToId: null });
  });

  it("runs once for a double tap inside one render", () => {
    const { send, sendInFlight } = heldSend();
    const onSending = vi.fn();
    const { result } = setup({ onSending, send, sendInFlight });
    act(() => {
      result.current.submit();
      result.current.submit();
    });
    expect(onSending).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not run with no channel open", () => {
    const onSending = vi.fn();
    const send = vi.fn().mockResolvedValue(false);
    const { result } = setup({ onSending, send, channelId: null });
    act(() => result.current.submit());
    expect(onSending).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not run for an edit", async () => {
    const onSending = vi.fn();
    const { result } = setup({ onSending });
    act(() => result.current.startEdit("m2"));
    act(() => result.current.onChangeText("fixed text"));
    await act(async () => {
      result.current.submit();
      await Promise.resolve();
    });
    expect(onSending).not.toHaveBeenCalled();
  });
});

describe("replyContextFor", () => {
  it("names nobody for a parent outside the loaded window", () => {
    expect(replyContextFor(null, VIEWER, nameFor, READY)).toEqual({
      title: REPLYING_TO_A_MESSAGE,
      preview: UNAVAILABLE_QUOTE,
    });
  });

  it("quotes a blocked member's message as the tombstone, never its words", () => {
    const context = replyContextFor(
      row("b1", BLOCKED, { content: "their words" }),
      VIEWER,
      nameFor,
      READY,
    );
    expect(context).toEqual({
      title: REPLYING_TO_A_MESSAGE,
      preview: TOMBSTONE_TEXT,
    });
  });
});

describe("useComposerStaging — edit", () => {
  it("shows the message's text in place of the draft, and never writes the draft", () => {
    const { result, input } = setup();
    act(() => result.current.startEdit("m2"));
    expect(result.current.context).toMatchObject({
      kind: "edit",
      title: EDITING_MESSAGE_TITLE,
    });
    expect(result.current.value).toBe("body m2");

    act(() => result.current.onChangeText("fixed text"));
    expect(result.current.value).toBe("fixed text");
    expect(input.setDraft).not.toHaveBeenCalled();
  });

  it("saves the edit and goes back to the draft", async () => {
    const { result, input } = setup();
    act(() => result.current.startEdit("m2"));
    act(() => result.current.onChangeText("fixed text "));
    await act(async () => {
      result.current.submit();
      await Promise.resolve();
    });
    expect(input.edit).toHaveBeenCalledWith("m2", "fixed text");
    expect(input.send).not.toHaveBeenCalled();
    expect(result.current.isEditing).toBe(false);
    expect(result.current.value).toBe("the draft");
  });

  it("keeps the edit open with the member's text when the save fails", async () => {
    const edit = vi
      .fn()
      .mockRejectedValue(new MemberFacingError("Couldn't edit message. Try again."));
    const { result } = setup({ edit });
    act(() => result.current.startEdit("m2"));
    act(() => result.current.onChangeText("fixed text"));
    await act(async () => {
      result.current.submit();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isEditing).toBe(true);
    expect(result.current.value).toBe("fixed text");
    expect(result.current.editError).toBe("Couldn't edit message. Try again.");
  });

  it("closes without a request when nothing changed", () => {
    const { result, input } = setup();
    act(() => result.current.startEdit("m2"));
    act(() => result.current.submit());
    expect(input.edit).not.toHaveBeenCalled();
    expect(result.current.isEditing).toBe(false);
  });

  it("says why an empty edit can't be saved, and never sends it", () => {
    const { result, input } = setup();
    act(() => result.current.startEdit("m2"));
    expect(result.current.editError).toBeNull();
    act(() => result.current.onChangeText("   "));
    // The composer greys Save out on an empty value; this is its reason.
    expect(result.current.editError).toBe(EDIT_EMPTY_HINT);
    act(() => result.current.submit());
    expect(input.edit).not.toHaveBeenCalled();
    act(() => result.current.onChangeText("back"));
    expect(result.current.editError).toBeNull();
  });

  it("closes when the message is deleted under it", () => {
    const { result, rerender, input } = setup();
    act(() => result.current.startEdit("m2"));
    rerender({
      ...input,
      byId: index(row("m1", FRIEND), row("m2", VIEWER, { is_deleted: true })),
    });
    expect(result.current.isEditing).toBe(false);
    expect(result.current.value).toBe("the draft");
  });

  it("keeps an open edit while its channel reloads with nothing cached", () => {
    const { result, rerender, input } = setup();
    act(() => result.current.startEdit("m2"));
    act(() => result.current.onChangeText("typed text"));
    rerender({ ...input, byId: new Map() });
    expect(result.current.isEditing).toBe(true);
    expect(result.current.value).toBe("typed text");
  });

  it("saves once, however fast Save is tapped", async () => {
    let settle!: () => void;
    const edit = vi.fn(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );
    const { result } = setup({ edit });
    act(() => result.current.startEdit("m2"));
    act(() => result.current.onChangeText("fixed"));
    act(() => {
      result.current.submit();
      result.current.submit();
    });
    expect(edit).toHaveBeenCalledTimes(1);
    expect(result.current.isSavingEdit).toBe(true);
    await act(async () => {
      settle();
      await Promise.resolve();
    });
    expect(result.current.isSavingEdit).toBe(false);
  });

  it("locks only the channel whose edit is saving, and saves there too", () => {
    const edit = vi.fn(() => new Promise<void>(() => {}));
    const byId = index(
      row("m2", VIEWER),
      row("d2", VIEWER, { channel_id: "chan-2" }),
    );
    const { result, rerender, input } = setup({ edit, byId });
    act(() => result.current.startEdit("m2"));
    act(() => result.current.onChangeText("fixed"));
    act(() => result.current.submit());
    expect(result.current.isSavingEdit).toBe(true);

    rerender({ ...input, edit, byId, channelId: "chan-2" });
    expect(result.current.isSavingEdit).toBe(false);
    act(() => result.current.startEdit("d2"));
    act(() => result.current.onChangeText("dues fixed"));
    act(() => result.current.submit());
    expect(edit).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenLastCalledWith("d2", "dues fixed");
  });

  it("closes an unchanged edit without a request even when the message isn't loaded", () => {
    const { result, rerender, input } = setup();
    act(() => result.current.startEdit("m2"));
    rerender({ ...input, byId: new Map() });
    act(() => result.current.submit());
    expect(input.edit).not.toHaveBeenCalled();
    expect(result.current.isEditing).toBe(false);
  });

  it("doesn't call a captionless photo's empty field a mistake", () => {
    const photo = row("p1", VIEWER, { content: "" });
    const { result } = setup({ byId: index(photo) });
    act(() => result.current.startEdit("p1"));
    expect(result.current.isEditing).toBe(true);
    expect(result.current.editError).toBeNull();
  });

  it("never lets a save for one edit close or fault the edit opened after it", async () => {
    let fail!: (error: Error) => void;
    let succeed!: () => void;
    const saves = [
      () => new Promise<void>((resolve) => (succeed = resolve)),
      () => new Promise<void>((_, reject) => (fail = reject)),
    ];
    const edit = vi.fn(() => saves.shift()!());
    const byId = index(
      row("m1", FRIEND),
      row("m2", VIEWER),
      row("m3", VIEWER),
      row("m4", VIEWER),
    );
    const { result } = setup({ edit, byId });

    // m2's save succeeds after the member has moved on to m3.
    act(() => result.current.startEdit("m2"));
    act(() => result.current.onChangeText("m2 fixed"));
    act(() => result.current.submit());
    act(() => result.current.startEdit("m3"));
    act(() => result.current.onChangeText("m3 draft"));
    await act(async () => {
      succeed();
      await Promise.resolve();
    });
    expect(result.current.isEditing).toBe(true);
    expect(result.current.value).toBe("m3 draft");

    // m3's save fails after the member has moved on to m4.
    act(() => result.current.submit());
    act(() => result.current.startEdit("m4"));
    await act(async () => {
      fail(new Error("Network error"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.value).toBe("body m4");
    expect(result.current.editError).toBeNull();
  });

  it("leaves an edit open in another channel alone when a reply is staged", () => {
    const { result, rerender, input } = setup({
      byId: index(
        row("m2", VIEWER),
        row("d1", FRIEND, { channel_id: "chan-2" }),
      ),
    });
    act(() => result.current.startEdit("m2"));
    rerender({
      ...input,
      channelId: "chan-2",
      byId: index(
        row("m2", VIEWER),
        row("d1", FRIEND, { channel_id: "chan-2" }),
      ),
    });
    act(() => result.current.startReply("d1"));
    expect(result.current.context?.kind).toBe("reply");
    rerender({
      ...input,
      byId: index(
        row("m2", VIEWER),
        row("d1", FRIEND, { channel_id: "chan-2" }),
      ),
    });
    expect(result.current.isEditing).toBe(true);
  });

  it("keeps a half-typed edit in one channel while another channel opens its own", () => {
    const byId = index(
      row("m2", VIEWER),
      row("d2", VIEWER, { channel_id: "chan-2" }),
      row("d1", FRIEND, { channel_id: "chan-2" }),
      row("m1", FRIEND),
    );
    const { result, rerender, input } = setup({ byId });
    act(() => result.current.startEdit("m2"));
    act(() => result.current.onChangeText("general, rewritten"));

    rerender({ ...input, byId, channelId: "chan-2" });
    act(() => result.current.startEdit("d2"));
    act(() => result.current.onChangeText("dues, rewritten"));

    rerender({ ...input, byId, channelId: "chan-1" });
    expect(result.current.isEditing).toBe(true);
    expect(result.current.value).toBe("general, rewritten");
    rerender({ ...input, byId, channelId: "chan-2" });
    expect(result.current.value).toBe("dues, rewritten");
  });

  it("keeps a reply staged in one channel while another channel stages its own", () => {
    const byId = index(
      row("m1", FRIEND),
      row("d1", FRIEND, { channel_id: "chan-2" }),
    );
    const { result, rerender, input } = setup({ byId });
    act(() => result.current.startReply("m1"));
    rerender({ ...input, byId, channelId: "chan-2" });
    act(() => result.current.startReply("d1"));
    rerender({ ...input, byId, channelId: "chan-1" });
    act(() => result.current.submit());
    expect(input.send).toHaveBeenLastCalledWith("the draft", {
      replyToId: "m1",
    });
  });

  it("replaces a staged reply, and a reply replaces an edit", () => {
    const { result } = setup();
    act(() => result.current.startReply("m1"));
    act(() => result.current.startEdit("m2"));
    expect(result.current.context?.kind).toBe("edit");
    act(() => result.current.startReply("m1"));
    expect(result.current.context?.kind).toBe("reply");
    expect(result.current.isEditing).toBe(false);
  });
});

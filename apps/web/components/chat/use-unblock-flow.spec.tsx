import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOCK_FAILURE_BODY,
  MASKED_RELOAD_FAILED_TITLE,
  UNBLOCK_CONFIRM_BODY,
} from "@repo/chat-core/block-copy";
import { maskedRefresh } from "@repo/chat-core/blocks";
import { emptyCache, mergeServerRow } from "@repo/chat-core/cache";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "@repo/chat-core/types";

const BLAKE = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  toast: vi.fn(),
  unblock: vi.fn(),
  GET: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFrappClient: () => ({ GET: mocks.GET }),
    useUnblockMember: () => ({
      mutateAsync: mocks.unblock,
      isPending: false,
    }),
  };
});

vi.mock("@/components/shared/confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: mocks.confirm, confirmDialog: null }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const { useUnblockFlow } = await import("./use-unblock-flow");

function maskedRow(id: string): RawChatMessage {
  return {
    id,
    channel_id: "chan-1",
    sender_id: BLAKE,
    author_name: null,
    content: "[message from a blocked member]",
    kind: "text",
    created_at: "2026-09-25T18:00:00.000000+00:00",
    sender_blocked: true,
  };
}

function setup() {
  const queryClient = new QueryClient();
  queryClient.setQueryData<ChannelCache>(
    chatMessagesKey("chan-1"),
    mergeServerRow(emptyCache(), maskedRow("m1")),
  );
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useUnblockFlow(), { wrapper });
  return { queryClient, result };
}

beforeEach(() => {
  mocks.confirm.mockReset();
  mocks.toast.mockReset();
  mocks.unblock.mockReset();
  mocks.GET.mockReset();
  maskedRefresh.reset();
});

describe("useUnblockFlow (#2313)", () => {
  it("asks first, then unblocks and brings the member's masked words back", async () => {
    mocks.confirm.mockResolvedValue({ comment: "" });
    mocks.unblock.mockResolvedValue(undefined);
    mocks.GET.mockResolvedValue({
      data: [
        {
          ...maskedRow("m1"),
          content: "the real words",
          sender_blocked: false,
        },
      ],
      response: new Response(null, { status: 200 }),
    });
    const { queryClient, result } = setup();

    await act(() => result.current.requestUnblock(BLAKE, "Blake Moss"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Unblock Blake Moss?",
        description: UNBLOCK_CONFIRM_BODY,
        confirmLabel: "Unblock",
      }),
    );
    expect(mocks.unblock).toHaveBeenCalledWith(BLAKE);
    expect(
      queryClient.getQueryData<ChannelCache>(chatMessagesKey("chan-1"))!.byId[
        "m1"
      ]!.content,
    ).toBe("the real words");
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("does nothing when the member cancels", async () => {
    mocks.confirm.mockResolvedValue(null);
    const { result } = setup();

    await act(() => result.current.requestUnblock(BLAKE, "Blake Moss"));

    expect(mocks.unblock).not.toHaveBeenCalled();
    expect(mocks.GET).not.toHaveBeenCalled();
  });

  it("says nothing changed when the unblock fails, and re-reads nothing", async () => {
    mocks.confirm.mockResolvedValue({ comment: "" });
    mocks.unblock.mockRejectedValue(new Error("offline"));
    const { result } = setup();

    await act(() => result.current.requestUnblock(BLAKE, null));

    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Couldn't unblock this member",
      description: BLOCK_FAILURE_BODY,
      variant: "destructive",
    });
    expect(mocks.GET).not.toHaveBeenCalled();
  });

  it("says so when a Reload's re-read fails again", async () => {
    mocks.GET.mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 503 }),
    });
    vi.useFakeTimers();
    try {
      const { result } = setup();
      const reload = result.current.reloadMaskedCopies(BLAKE);
      await vi.runAllTimersAsync();
      await act(() => reload);
    } finally {
      vi.useRealTimers();
    }

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: MASKED_RELOAD_FAILED_TITLE }),
    );
    expect(maskedRefresh.snapshot().get(BLAKE)).toBe("failed");
  });
});

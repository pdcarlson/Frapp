/** @vitest-environment jsdom */
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { Alert } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatMessagesKey } from "@repo/chat-core/types";

const mutations = vi.hoisted(() => ({
  block: vi.fn(),
  unblock: vi.fn(),
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useBlockMember: () => ({ mutateAsync: mutations.block, isPending: false }),
    useUnblockMember: () => ({
      mutateAsync: mutations.unblock,
      isPending: false,
    }),
  };
});

import {
  BLOCK_FAILURE_BODY,
  confirmBlockMember,
  confirmUnblockMember,
  useBlockActions,
} from "./block-actions";

const BLOCKED = "22222222-2222-4222-8222-222222222222";

function wrapperFor(queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.mocked(Alert.alert).mockClear();
  mutations.block.mockReset();
  mutations.unblock.mockReset();
});

describe("useBlockActions", () => {
  it("re-reads every cached thread after a block, so the server re-masks them", async () => {
    mutations.block.mockResolvedValue({ id: "b1" });
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBlockActions(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(() => result.current.block(BLOCKED));

    expect(mutations.block).toHaveBeenCalledWith(BLOCKED);
    // A prefix of every channel's key, not only the open thread's.
    const [call] = invalidate.mock.calls;
    const prefix = call![0]!.queryKey as readonly unknown[];
    expect(chatMessagesKey("any-channel").slice(0, prefix.length)).toEqual(
      prefix,
    );
  });

  it("does the same after an unblock, which is what brings their words back", async () => {
    mutations.unblock.mockResolvedValue(undefined);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBlockActions(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(() => result.current.unblock(BLOCKED));

    expect(mutations.unblock).toHaveBeenCalledWith(BLOCKED);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("touches no cache when the write fails", async () => {
    mutations.block.mockRejectedValue(new Error("offline"));
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBlockActions(), {
      wrapper: wrapperFor(queryClient),
    });

    await expect(act(() => result.current.block(BLOCKED))).rejects.toThrow(
      "offline",
    );
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("confirmBlockMember / confirmUnblockMember", () => {
  function buttons() {
    const call = vi.mocked(Alert.alert).mock.calls[0]!;
    return call[2]!;
  }

  it("names the member, and runs nothing until confirmed", () => {
    const run = vi.fn().mockResolvedValue(undefined);
    confirmBlockMember({ name: "Blake", run });

    expect(vi.mocked(Alert.alert).mock.calls[0]![0]).toBe("Block Blake?");
    expect(run).not.toHaveBeenCalled();
    buttons()
      .find((button) => button.style === "cancel")
      ?.onPress?.();
    expect(run).not.toHaveBeenCalled();
  });

  it("falls back to a neutral name when the roster cannot resolve one", () => {
    confirmUnblockMember({ name: null, run: vi.fn() });
    expect(vi.mocked(Alert.alert).mock.calls[0]![0]).toBe(
      "Unblock this member?",
    );
  });

  it("runs on confirm, then calls onDone", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn();
    confirmBlockMember({ name: "Blake", run, onDone });

    buttons()
      .find((button) => button.style === "destructive")
      ?.onPress?.();
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reports a failure instead of pretending it worked", async () => {
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    const onDone = vi.fn();
    confirmUnblockMember({ name: "Blake", run, onDone });

    buttons()
      .find((button) => button.text === "Unblock")
      ?.onPress?.();
    await flush();

    expect(onDone).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      "Couldn't unblock Blake",
      BLOCK_FAILURE_BODY,
    );
  });
});

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOCK_FAILURE_BODY,
  BLOCK_NOT_A_MEMBER_BODY,
} from "@repo/chat-core/block-copy";

const BLAKE = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  toast: vi.fn(),
  block: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useBlockMember: () => ({ mutateAsync: mocks.block, isPending: false }),
  };
});

vi.mock("@/components/shared/confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: mocks.confirm, confirmDialog: null }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const { useBlockFlow } = await import("./use-block-flow");

function request(inDirectory = true) {
  return { userId: BLAKE, name: "Blake Rivera", inDirectory };
}

beforeEach(() => {
  mocks.confirm.mockReset();
  mocks.toast.mockReset();
  mocks.block.mockReset();
});

describe("useBlockFlow (#2687)", () => {
  it("asks first, with web's undo location, then blocks", async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.block.mockResolvedValue(undefined);
    const { result } = renderHook(() => useBlockFlow());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.requestBlock(request());
    });
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Block Blake Rivera?",
        confirmLabel: "Block",
        description: expect.stringMatching(
          /unblock them anytime from your profile\.$/,
        ),
      }),
    );
    expect(mocks.block).toHaveBeenCalledWith(BLAKE);
    expect(outcome).toBe("blocked");
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("does nothing when the member cancels", async () => {
    mocks.confirm.mockResolvedValue(false);
    const { result } = renderHook(() => useBlockFlow());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.requestBlock(request());
    });
    expect(outcome).toBe("cancelled");
    expect(mocks.block).not.toHaveBeenCalled();
  });

  it("toasts a connection failure", async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.block.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useBlockFlow());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.requestBlock(request());
    });
    expect(outcome).toBe("failed");
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't block Blake Rivera",
        description: BLOCK_FAILURE_BODY,
      }),
    );
  });

  it("says a departed member cannot be blocked, and reports it", async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.block.mockRejectedValue({
      statusCode: 404,
      message: "Member not found",
    });
    const { result } = renderHook(() => useBlockFlow());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.requestBlock(request(false));
    });
    expect(outcome).toBe("not-a-member");
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: BLOCK_NOT_A_MEMBER_BODY }),
    );
  });
});

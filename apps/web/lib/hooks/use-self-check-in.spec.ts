import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn();
const toast = vi.fn();

vi.mock("@repo/hooks", () => ({
  useCheckIn: () => ({ mutateAsync, isPending: false, isSuccess: false }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const { useSelfCheckIn } = await import("./use-self-check-in");

beforeEach(() => {
  mutateAsync.mockReset();
  toast.mockReset();
});

/**
 * `run`'s answer is what Activity's row button settles on (#4427): `true`
 * once the member is on the list, `false` for a refusal it has toasted.
 */
describe("useSelfCheckIn", () => {
  it("answers true once checked in", async () => {
    mutateAsync.mockResolvedValue({});
    const { result } = renderHook(() => useSelfCheckIn());
    await expect(result.current.run("e1", 10)).resolves.toBe(true);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Checked in" }),
    );
  });

  it("answers true on a 409, saying only that the member is on the list", async () => {
    mutateAsync.mockRejectedValue({ status: 409 });
    const { result } = renderHook(() => useSelfCheckIn());
    await expect(result.current.run("e1", 10)).resolves.toBe(true);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Already on the list" }),
    );
  });

  it("answers false for any other refusal, which it has toasted", async () => {
    mutateAsync.mockRejectedValue({ status: 403, message: "Scan the code" });
    const { result } = renderHook(() => useSelfCheckIn());
    await expect(result.current.run("e1", 10)).resolves.toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't check in",
        variant: "destructive",
      }),
    );
  });
});

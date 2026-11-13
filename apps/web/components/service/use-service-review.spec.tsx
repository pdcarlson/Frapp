import {
  act,
  render,
  renderHook,
  screen,
  fireEvent,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMutateAsync = vi.fn();
const mockToast = vi.fn();

vi.mock("@repo/hooks", () => ({
  useReviewServiceEntry: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
  // `toastFailure` (`@/lib/failure-toast`) calls the module's `toast`.
  toast: mockToast,
}));

const { useServiceReview } = await import("./use-service-review");

const entry = { id: "entry-1", description: "Food bank" };

beforeEach(() => {
  vi.clearAllMocks();
});

/*
  The one review flow both the Service hours queue and the Activity panel run
  (#3897). These pin what either page depends on: the request each button
  sends, what it tells the member, and what it resolves to.
*/
describe("useServiceReview", () => {
  it("approves with APPROVED, says so, and resolves true", async () => {
    mockMutateAsync.mockResolvedValue({});
    const { result } = renderHook(() => useServiceReview());

    let recorded: boolean | undefined;
    await act(async () => {
      recorded = await result.current.approve(entry);
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      id: "entry-1",
      body: { status: "APPROVED" },
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Entry approved" }),
    );
    expect(recorded).toBe(true);
  });

  it("toasts a refused approval and resolves false", async () => {
    mockMutateAsync.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useServiceReview());

    let recorded: boolean | undefined;
    await act(async () => {
      recorded = await result.current.approve(entry);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't approve entry",
        variant: "destructive",
      }),
    );
    expect(recorded).toBe(false);
  });

  it("offers Try again when the approval died on the server, not when it was refused", async () => {
    const { result } = renderHook(() => useServiceReview());

    mockMutateAsync.mockRejectedValueOnce({ statusCode: 503, message: "x" });
    await act(async () => {
      await result.current.approve(entry);
    });
    const failed = mockToast.mock.calls.at(-1)?.[0] as {
      action?: { props: { onClick: () => void } };
    };
    expect(failed.action).toBeDefined();

    // Try again sends the same approval.
    mockMutateAsync.mockResolvedValueOnce({});
    await act(async () => {
      failed.action!.props.onClick();
    });
    expect(mockMutateAsync).toHaveBeenLastCalledWith({
      id: "entry-1",
      body: { status: "APPROVED" },
    });
    expect(mockToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Entry approved" }),
    );

    mockMutateAsync.mockRejectedValueOnce({ statusCode: 400, message: "x" });
    await act(async () => {
      await result.current.approve(entry);
    });
    expect(mockToast.mock.calls.at(-1)?.[0]).not.toHaveProperty("action");
  });

  function Harness({ onDone }: { onDone: (recorded: boolean) => void }) {
    const review = useServiceReview();
    return (
      <>
        <button onClick={() => void review.reject(entry).then(onDone)}>
          reject
        </button>
        {review.confirmDialog}
      </>
    );
  }

  it("asks before rejecting, and sends nothing when the member cancels", async () => {
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "reject" }));
    expect(await screen.findByText('Reject "Food bank"?')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    });

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it("rejects with the member's comment once confirmed", async () => {
    mockMutateAsync.mockResolvedValue({});
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "reject" }));
    fireEvent.change(await screen.findByLabelText("Comment for the member"), {
      target: { value: "Wrong date" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reject entry" }));
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      id: "entry-1",
      body: { status: "REJECTED", review_comment: "Wrong date" },
    });
    expect(onDone).toHaveBeenCalledWith(true);
  });
});

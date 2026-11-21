import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComingUpReviewRow } from "@repo/validation";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  track: vi.fn(),
  rows: { current: null as ComingUpReviewRow[] | null },
}));

vi.mock("@repo/hooks", () => ({
  useComingUpPostReview: (_id: string, _content: unknown, enabled: boolean) =>
    enabled ? mocks.rows.current : null,
  useMemberDisplayNames: () => ({
    nameFor: (id: string) => (id === "u-marcus" ? "Marcus Hale" : null),
  }),
  useTrackComingUpDates: () => ({
    mutateAsync: mocks.track,
    isPending: false,
  }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const { ComingUpPostReview } = await import("./coming-up-post-review");

const row = (over: Partial<ComingUpReviewRow>): ComingUpReviewRow => ({
  index: 0,
  date: "2099-11-21",
  text: "Dues due to the treasurer",
  kind: "task",
  title: "Dues due to the treasurer",
  description: null,
  assigneeId: "u-marcus",
  suggestion: null,
  checked: true,
  ...over,
});

const content = { dates: [], action_items: [] };

describe("ComingUpPostReview", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    mocks.track.mockReset().mockResolvedValue({ made: 1, failed: 0 });
    mocks.rows.current = [
      row({}),
      row({
        index: 1,
        date: "2099-12-02",
        title: "Philanthropy committee reports back",
        assigneeId: null,
        checked: true,
      }),
      row({
        index: 2,
        date: "2099-12-06",
        kind: "calendar",
        title: "Winter Formal",
        assigneeId: null,
        checked: false,
      }),
    ];
  });

  it("shows what each date needs, every task line ticked", () => {
    render(
      <ComingUpPostReview
        meetingId="m-1"
        content={content}
        viewerId="u-me"
        onDone={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("dialog", {
        name: "Track the dates from this meeting?",
      }),
    ).toBeTruthy();
    const marcus = screen.getByRole("checkbox", {
      name: /Task for Marcus Hale/,
    }) as HTMLInputElement;
    const mine = screen.getByRole("checkbox", {
      name: /Task for you/,
    }) as HTMLInputElement;
    expect(marcus.checked).toBe(true);
    expect(mine.checked).toBe(true);
    expect(screen.getByText("Already on the calendar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Track 2" })).toBeTruthy();
  });

  it("makes what is left ticked, then says so and closes", async () => {
    const onDone = vi.fn();
    render(
      <ComingUpPostReview
        meetingId="m-1"
        content={content}
        viewerId="u-me"
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Task for you/ }));
    fireEvent.click(screen.getByRole("button", { name: "Track 1" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.track).toHaveBeenCalledWith({
      rows: [mocks.rows.current![0]],
      viewerId: "u-me",
    });
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Made 1 task" });
  });

  it("says which tasks it couldn't make", async () => {
    mocks.track.mockResolvedValue({ made: 0, failed: 1 });
    render(
      <ComingUpPostReview
        meetingId="m-1"
        content={content}
        viewerId="u-me"
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Track 2" }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't make 1 task",
          variant: "destructive",
        }),
      ),
    );
  });

  it("closes without a word when no date needs a task", () => {
    mocks.rows.current = [mocks.rows.current![2]!];
    const onDone = vi.fn();
    render(
      <ComingUpPostReview
        meetingId="m-1"
        content={content}
        viewerId="u-me"
        onDone={onDone}
      />,
    );
    expect(onDone).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays open when what it read changes under it", () => {
    const onDone = vi.fn();
    const props = {
      meetingId: "m-1",
      content,
      viewerId: "u-me",
      onDone,
    };
    const { rerender } = render(<ComingUpPostReview {...props} />);
    // The tasks Track makes refetch the dates' tracking: no line needs one.
    mocks.rows.current = [];
    rerender(<ComingUpPostReview {...props} />);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Skip closes and makes nothing", () => {
    const onDone = vi.fn();
    render(
      <ComingUpPostReview
        meetingId="m-1"
        content={content}
        viewerId="u-me"
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onDone).toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });
});

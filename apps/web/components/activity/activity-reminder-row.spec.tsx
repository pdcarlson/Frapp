import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "@repo/hooks";
import { activityGroups } from "@repo/hooks/activity-rows";
import {
  MESSAGE_REMINDER_PRESETS,
  messageReminderPresetTime,
} from "@repo/hooks/use-message-reminders";

const mockPush = vi.fn();
const mockToast = vi.fn();
const mockSet = vi.fn();
const mockClear = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));
vi.mock("@repo/hooks", () => ({
  MESSAGE_REMINDER_PRESETS,
  messageReminderPresetTime,
  useSetMessageReminder: () => ({ mutateAsync: mockSet }),
  useClearMessageReminder: () => ({ mutateAsync: mockClear }),
}));

const { ActivityReminderRow, useActivityReminderActions } =
  await import("./activity-reminder-row");

type ReminderRow = Extract<ActivityRow, { kind: "reminder" }>;

/** The row the real model draws for a reminder. */
function rowFor(overrides: Record<string, unknown> = {}): ReminderRow {
  const reminder = {
    id: "r1",
    message_id: "m9",
    thread_root_id: null,
    channel_id: "c1",
    channel_name: "general",
    channel_type: "PUBLIC",
    author_name: "Olive",
    preview: "Bring the banner Friday",
    message_created_at: "2026-11-10T15:00:00.000Z",
    message_available: true,
    remind_at: "2099-01-01T14:00:00.000Z",
    fired_at: null,
    due: false,
    ...overrides,
  };
  const groups = activityGroups(
    {
      needs_you: {
        tasks: [],
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
      },
      coming_up: [],
      links: [],
      made_by_you: { polls: [], tasks: [], events: [] },
      needs_you_count: 0,
      unavailable: [],
      reminders: [reminder],
    } as unknown as Parameters<typeof activityGroups>[0],
    new Date("2026-11-14T15:00:00.000Z"),
  );
  return groups.find((group) => group.id === "reminders")!
    .rows[0] as ReminderRow;
}

/** The row as the page draws it: the page owns the writes. */
function Page({ row }: { row: ReminderRow }) {
  const actions = useActivityReminderActions();
  return (
    <ul>
      <ActivityReminderRow row={row} rowClassName="" actions={actions} />
    </ul>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue(undefined);
  mockClear.mockResolvedValue(undefined);
});

describe("ActivityReminderRow (#4957)", () => {
  it("opens the message in chat", () => {
    render(<Page row={rowFor()} />);
    expect(
      screen.getByRole("link", { name: /Bring the banner Friday/ }),
    ).toHaveAttribute("href", "/chat?channel=c1&message=m9");
  });

  it("opens a thread reply at its thread's first message", () => {
    render(<Page row={rowFor({ thread_root_id: "root-1" })} />);
    expect(
      screen.getByRole("link", { name: /Bring the banner Friday/ }),
    ).toHaveAttribute("href", "/chat?channel=c1&message=root-1");
  });

  it("doesn't open a message the member can no longer read", () => {
    render(
      <Page
        row={rowFor({
          message_available: false,
          channel_name: null,
          channel_type: null,
        })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Done: Bring the banner Friday" }),
    ).toBeInTheDocument();
  });

  it("offers no Snooze on a reminder the member can no longer read, which can only be cleared", async () => {
    const user = userEvent.setup();
    render(
      <Page
        row={rowFor({
          message_available: false,
          channel_name: null,
          channel_type: null,
        })}
      />,
    );
    const more = screen.queryByRole("button", {
      name: "More for Bring the banner Friday",
    });
    if (more) {
      await user.click(more);
      expect(screen.queryByRole("menuitem", { name: "Tomorrow" })).toBeNull();
    }
  });

  it("clears the reminder on Done and says so", async () => {
    const user = userEvent.setup();
    render(<Page row={rowFor()} />);

    await user.click(
      screen.getByRole("button", { name: "Done: Bring the banner Friday" }),
    );

    expect(mockClear).toHaveBeenCalledWith("m9");
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Marked done",
        description: "Bring the banner Friday",
      }),
    );
  });

  it("snoozes to a preset from the row's menu", async () => {
    const user = userEvent.setup();
    render(<Page row={rowFor()} />);

    await user.click(
      screen.getByRole("button", { name: "More for Bring the banner Friday" }),
    );
    const items = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
    expect(items).toEqual([
      "In 20 minutes",
      "In 1 hour",
      "In 3 hours",
      "Tomorrow",
      "Next week",
      "Open in chat",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Tomorrow" }));

    expect(mockSet).toHaveBeenCalledTimes(1);
    const { messageId, remindAt } = mockSet.mock.calls[0]![0] as {
      messageId: string;
      remindAt: Date;
    };
    expect(messageId).toBe("m9");
    expect(remindAt.getHours()).toBe(9);
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Snoozed",
        description: expect.stringMatching(/^I'll remind you tomorrow at 9:00/),
      }),
    );
  });

  it("toasts a failed Done", async () => {
    const user = userEvent.setup();
    mockClear.mockRejectedValueOnce(new Error("Network down"));
    render(<Page row={rowFor()} />);

    await user.click(
      screen.getByRole("button", { name: "Done: Bring the banner Friday" }),
    );

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: "Couldn't clear the reminder",
        }),
      ),
    );
  });
});

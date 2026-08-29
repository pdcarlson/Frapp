import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter, mockRollover } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockRollover: vi.fn(),
}));

const PERMISSIONS = ["chapter-config:manage", "semester:rollover"];

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: PERMISSIONS },
    isPending: false,
    isError: false,
  }),
  usePermissionsCatalog: () => ({ data: [], isPending: false, isError: false }),
  useSemesters: () => ({ data: [], isPending: false, isError: false }),
  useSemesterRollover: () => ({ mutateAsync: mockRollover, isPending: false }),
  useUpdateChapter: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreatePortal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOrgConfig: () => ({
    data: { org_archetype: "ifc" },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePatchOrgConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePendingConfigKeys: () => new Set<string>(),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { SettingsPage } = await import("./settings-page");

const chapter = chapterSubscription(mockCurrentChapter);

const promoteSwitch = () =>
  screen.getByRole("switch", { name: /promote new members to member/i });

/** Fill the three required fields and submit, leaving the confirm dialog open. */
async function submitRollover(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^label$/i), "Fall 2026");
  await user.type(screen.getByLabelText(/start date/i), "2026-08-01");
  await user.type(screen.getByLabelText(/end date/i), "2026-12-15");
  await user.click(
    screen.getByRole("button", { name: /archive current semester/i }),
  );
}

describe("semester rollover — New Member promotion (#285)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
    mockRollover.mockResolvedValue({});
  });

  it("offers the promotion, off by default", () => {
    render(<SettingsPage />);

    // Off by default is the whole safety property: promotion rewrites roles
    // across the chapter, so it must be opted into per rollover.
    expect(promoteSwitch()).not.toBeChecked();
  });

  it("sends promote_new_members: false when the officer leaves it alone", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await submitRollover(user);
    await user.click(screen.getByRole("button", { name: /start new semester/i }));

    expect(mockRollover).toHaveBeenCalledWith(
      expect.objectContaining({ promote_new_members: false }),
    );
  });

  it("sends promote_new_members: true once the officer opts in", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(promoteSwitch());
    await submitRollover(user);
    await user.click(screen.getByRole("button", { name: /start new semester/i }));

    expect(mockRollover).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Fall 2026",
        start_date: "2026-08-01",
        end_date: "2026-12-15",
        promote_new_members: true,
      }),
    );
  });

  it("states the role change in the confirmation before it runs", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(promoteSwitch());
    await submitRollover(user);

    // The officer has to be told what the extra box does at the point of
    // confirming — a bulk role change is not undoable in one step.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/promoted to Member/i);
    expect(dialog).toHaveTextContent(/keep any other roles they hold/i);
    expect(dialog).toHaveTextContent(/cannot be undone/i);
  });

  it("stays silent about promotion when it was not requested", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await submitRollover(user);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).not.toHaveTextContent(/promoted to Member/i);
  });

  it("does not fire the rollover at all when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(promoteSwitch());
    await submitRollover(user);
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(mockRollover).not.toHaveBeenCalled();
  });

  it("gates the promotion toggle with the same subscription gate as the submit", async () => {
    // A control the chapter cannot act on must not be live. The submit is
    // already gated; a toggle left enabled beside it reads as usable.
    chapter.incomplete();
    render(<SettingsPage />);

    expect(promoteSwitch()).toBeDisabled();
  });
});

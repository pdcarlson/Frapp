import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

const PERMISSIONS = [
  "chapter-config:manage",
  "semester:rollover",
  "billing:view",
  "billing:manage",
];

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: PERMISSIONS },
    isPending: false,
    isError: false,
  }),
  usePermissionsCatalog: () => ({ data: [], isPending: false, isError: false }),
  useSemesters: () => ({ data: [], isPending: false, isError: false }),
  useSemesterRollover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateChapter: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreatePortal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/use-org-config", () => ({
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

// The permission gate has its own tests; here it must not swallow the controls.
vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { SettingsPage } = await import("./settings-page");

const chapter = chapterSubscription(mockCurrentChapter);

const rolloverButton = () =>
  screen.getByRole("button", { name: /archive current semester/i });
const saveProfileButton = () =>
  screen.getByRole("button", { name: /save profile/i });
const portalButton = () =>
  screen.getByRole("button", { name: /open stripe billing portal/i });

describe("settings semester rollover subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves the rollover control alone on an active chapter", () => {
    chapter.active();
    render(<SettingsPage />);

    expect(rolloverButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the rollover and names the blocker when incomplete", () => {
    chapter.incomplete();
    render(<SettingsPage />);

    expect(rolloverButton()).toBeDisabled();
    expect(
      screen.getByText(/subscription is not active/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");
  });

  it("ties the disabled rollover to the one explanation", () => {
    chapter.incomplete();
    render(<SettingsPage />);

    const describedBy = rolloverButton().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /restore semester rollover/i,
    );
  });

  it("leaves the other settings writes alone — they are not paid-ops", () => {
    // `SemesterRolloverController` is the only paid-ops controller behind this
    // screen. Chapter profile (`chapter`) and org config (`chapter-config`) are
    // `@FreeTier`, and `billing` is exempt because it is the recovery path
    // (§5 rule 3). Gating them would lock a lapsed chapter out of settings it
    // is still entitled to change.
    chapter.incomplete();
    render(<SettingsPage />);

    expect(saveProfileButton()).toBeEnabled();
    expect(portalButton()).toBeEnabled();
  });

  it("leaves the accent-color write alone too", async () => {
    // Lives on the Theme tab, so it only mounts once that tab is selected —
    // and it patches `chapter`, another `@FreeTier` route.
    chapter.incomplete();
    render(<SettingsPage />);

    await userEvent.click(screen.getByRole("tab", { name: /theme/i }));

    expect(
      screen.getByRole("button", { name: /save accent color/i }),
    ).toBeEnabled();
  });

  it("never gates the rollover form's own fields", () => {
    // They hold local state — the write is the submit, and disabling that also
    // suppresses implicit Enter submission. Matches the reference consumer,
    // which leaves its dialog fields alone as well.
    chapter.incomplete();
    render(<SettingsPage />);

    expect(screen.getByLabelText(/^label$/i)).toBeEnabled();
    expect(screen.getByLabelText(/start date/i)).toBeEnabled();
    expect(screen.getByLabelText(/end date/i)).toBeEnabled();
  });

  it("fails open when the subscription status cannot be established", () => {
    // Deliberately asymmetric with `<Can>`, which fails closed. A status this
    // client does not model must not lock a chapter that is most likely paying.
    chapter.raw("trialing");
    render(<SettingsPage />);

    expect(rolloverButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("asserts no blocker when the chapter record cannot be read", () => {
    // The gate and this page share one `useCurrentChapter` query (§5 "read
    // subscription state from one place"), so a failed fetch takes the whole
    // screen to its error state before any control renders. The gate's job here
    // is the negative one: never claim a reason nothing established.
    chapter.unreadable();
    render(<SettingsPage />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/couldn't load chapter settings/i),
    ).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

/**
 * Unsaved drafts outlive a tab switch (#3272).
 *
 * `TabsContent` carries no `forceMount`, so Radix unmounts the tab an officer
 * leaves. The Accent draft and the rollover form are held by the page
 * (`useAccentDraft`, `useRolloverForm`) for exactly that reason; moving either
 * hook into its tab component would compile, pass every other settings spec,
 * and silently wipe a half-typed colour or semester on the first glance at
 * another tab.
 */

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: ["*"] },
    isPending: false,
    isError: false,
  }),
  usePermissionsCatalog: () => ({ data: [], isPending: false, isError: false }),
  useSemesters: () => ({ data: [], isPending: false, isError: false }),
  useSemesterRollover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadChapterLogo: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveChapterLogo: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { SettingsPage } = await import("./settings-page");

const chapter = chapterSubscription(mockCurrentChapter);

describe("the Settings page keeps unsaved drafts across tab switches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it("keeps a typed accent draft", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /accent/i }));
    const hex = screen.getByLabelText(/accent color hex value/i);
    await user.clear(hex);
    await user.type(hex, "#5AA9E6");

    await user.click(screen.getByRole("tab", { name: /^modules$/i }));
    expect(screen.queryByLabelText(/accent color hex value/i)).toBeNull();
    await user.click(screen.getByRole("tab", { name: /accent/i }));

    expect(screen.getByLabelText(/accent color hex value/i)).toHaveValue(
      "#5AA9E6",
    );
  });

  it("keeps a half-filled rollover form", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /semester/i }));
    await user.type(screen.getByLabelText(/^label$/i), "Fall 2026");

    await user.click(screen.getByRole("tab", { name: /^modules$/i }));
    expect(screen.queryByLabelText(/^label$/i)).toBeNull();
    await user.click(screen.getByRole("tab", { name: /semester/i }));

    expect(screen.getByLabelText(/^label$/i)).toHaveValue("Fall 2026");
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The Settings page's logo wiring (#2591): what `settings-page.tsx` feeds the
 * Chapter mark card. `settings-org-tab.spec.tsx` pins the card against the
 * props it is given; this renders the real page and checks those props come
 * from the right places: the current logo from `logo_url` on the chapter read,
 * the upload and removal through the logo hooks, and a toast either way.
 */

const { chapter, upload, remove, toast } = vi.hoisted(() => ({
  chapter: { current: {} as Record<string, unknown> },
  upload: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => ({
    data: chapter.current,
    isPending: false,
    isError: false,
  }),
  useMyPermissions: () => ({
    data: { permissions: ["*"] },
    isPending: false,
    isError: false,
  }),
  usePermissionsCatalog: () => ({ data: [], isPending: false, isError: false }),
  useSemesters: () => ({ data: [], isPending: false, isError: false }),
  useSemesterRollover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateChapter: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadChapterLogo: () => ({ mutateAsync: upload, isPending: false }),
  useRemoveChapterLogo: () => ({ mutateAsync: remove, isPending: false }),
  useCreatePortal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOrgConfig: () => ({
    data: { org_archetype: "ifc", branding: { greek_letters: "ΦΓΔ" } },
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

vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const { SettingsPage } = await import("./settings-page");

function chapterWith(extra: Record<string, unknown>) {
  chapter.current = {
    name: "Tau Nu",
    university: "Rensselaer Polytechnic Institute",
    subscription_status: "active",
    past_due_since: null,
    ...extra,
  };
}

describe("the Settings page's chapter logo wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upload.mockResolvedValue({});
    remove.mockResolvedValue({});
  });

  it("previews the current logo from the chapter read's logo_url", () => {
    chapterWith({ logo_url: "https://storage.example/signed/logo.png" });
    render(<SettingsPage />);
    expect(screen.getByTestId("chapter-mark-logo")).toHaveAttribute(
      "src",
      "https://storage.example/signed/logo.png",
    );
    expect(
      screen.getByRole("button", { name: /replace logo/i }),
    ).toBeInTheDocument();
  });

  it("uploads a picked file through the logo hook and says so", async () => {
    chapterWith({ logo_url: null });
    const user = userEvent.setup();
    render(<SettingsPage />);
    const file = new File(["png"], "crest.png", { type: "image/png" });

    await user.upload(screen.getByLabelText(/^logo$/i), file);

    await waitFor(() =>
      expect(upload).toHaveBeenCalledWith({
        body: file,
        filename: "crest.png",
        contentType: "image/png",
      }),
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Logo saved" }),
    );
  });

  it("reports a failed upload", async () => {
    chapterWith({ logo_url: null });
    upload.mockRejectedValue(new Error("Logo upload failed (413)"));
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.upload(
      screen.getByLabelText(/^logo$/i),
      new File(["png"], "crest.png", { type: "image/png" }),
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't upload the logo",
          description: "Logo upload failed (413)",
          variant: "destructive",
        }),
      ),
    );
  });

  it("removes the logo through the logo hook", async () => {
    chapterWith({ logo_url: "https://storage.example/signed/logo.png" });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: /remove logo/i }));

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Logo removed" }),
    );
  });
});

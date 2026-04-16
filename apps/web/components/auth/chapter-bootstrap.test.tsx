"use client";

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChapterBootstrap } from "@/components/auth/chapter-bootstrap";
import { toast } from "@/hooks/use-toast";

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockSetActiveChapterId = vi.fn();
const mockCreateChapter = vi.fn();
const mockCreateCheckout = vi.fn();
const mockRefetchChapters = vi.fn();
const mockRefetchBilling = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    refresh: mockRefresh,
  }),
}));

vi.mock("@repo/hooks", () => ({
  useAccessibleChapters: vi.fn(),
  useCurrentUser: vi.fn(),
  useCreateChapter: vi.fn(),
  useCreateCheckout: vi.fn(),
  useBillingStatus: vi.fn(),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (state: { activeChapterId: string | null; setActiveChapterId: (id: string | null) => void }) => unknown) =>
    selector({
      activeChapterId: null,
      setActiveChapterId: mockSetActiveChapterId,
    }),
}));

vi.mock("@/hooks/use-toast", async () => {
  return {
    toast: vi.fn(),
    useToast: () => ({ toast }),
  };
});

const hooks = await import("@repo/hooks");

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "ChapterBootstrapTestWrapper";
  return Wrapper;
}

describe("ChapterBootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetchChapters.mockResolvedValue(undefined);
    mockRefetchBilling.mockResolvedValue(undefined);
    vi.mocked(hooks.useCurrentUser).mockReturnValue({
      data: { id: "user-1", email: "president@example.com" },
      isLoading: false,
    } as never);
    vi.mocked(hooks.useBillingStatus).mockReturnValue({
      data: { subscription_status: "active" },
      isFetching: false,
      refetch: mockRefetchBilling,
    } as never);
    vi.mocked(hooks.useCreateChapter).mockReturnValue({
      mutateAsync: mockCreateChapter,
      isPending: false,
    } as never);
    vi.mocked(hooks.useCreateCheckout).mockReturnValue({
      mutateAsync: mockCreateCheckout,
      isPending: false,
    } as never);
  });

  it("renders chapter creation when the user has no memberships", async () => {
    vi.mocked(hooks.useAccessibleChapters).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetchChapters,
    } as never);

    render(<ChapterBootstrap />, { wrapper: createWrapper() });

    expect(screen.getByText("Create your chapter")).toBeInTheDocument();
  });

  it("creates a chapter and persists the new active chapter", async () => {
    mockCreateChapter.mockResolvedValue({ id: "chapter-1" });
    vi.mocked(hooks.useAccessibleChapters).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetchChapters,
    } as never);

    render(<ChapterBootstrap />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText("Chapter name"), {
      target: { value: "Alpha Beta" },
    });
    fireEvent.change(screen.getByLabelText("University"), {
      target: { value: "State U" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create chapter/i }));

    await waitFor(() => {
      expect(mockCreateChapter).toHaveBeenCalledWith({
        name: "Alpha Beta",
        university: "State U",
      });
    });
    expect(mockSetActiveChapterId).toHaveBeenCalledWith("chapter-1");
    expect(mockRefetchChapters).toHaveBeenCalled();
  });

  it("lists memberships and allows selecting another chapter", async () => {
    vi.mocked(hooks.useAccessibleChapters).mockReturnValue({
      data: [
        {
          member_id: "member-1",
          chapter_id: "chapter-1",
          role_ids: ["role-president"],
          has_completed_onboarding: true,
          chapter: {
            id: "chapter-1",
            name: "Alpha",
            university: "State U",
            stripe_customer_id: null,
            subscription_status: "active",
            subscription_id: null,
            accent_color: "#2563EB",
            logo_path: null,
            donation_url: null,
            created_at: "2024-01-01",
            updated_at: "2024-01-01",
          },
        },
        {
          member_id: "member-2",
          chapter_id: "chapter-2",
          role_ids: ["role-member"],
          has_completed_onboarding: false,
          chapter: {
            id: "chapter-2",
            name: "Beta",
            university: "Tech U",
            stripe_customer_id: null,
            subscription_status: "incomplete",
            subscription_id: null,
            accent_color: "#1D4ED8",
            logo_path: null,
            donation_url: null,
            created_at: "2024-01-02",
            updated_at: "2024-01-02",
          },
        },
      ],
      isLoading: false,
      isError: false,
      refetch: mockRefetchChapters,
    } as never);

    render(<ChapterBootstrap />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /Beta/i }));

    await waitFor(() => {
      expect(mockSetActiveChapterId).toHaveBeenCalledWith("chapter-2");
    });
    expect(mockRefetchBilling).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });
});

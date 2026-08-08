import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { selectChapter, toast, chaptersQuery } = vi.hoisted(() => ({
  selectChapter: vi.fn(async () => true),
  toast: vi.fn(),
  chaptersQuery: {
    current: { data: [] as unknown[], isSuccess: true },
  },
}));

vi.mock("@repo/hooks", () => ({
  useAccessibleChapters: () => chaptersQuery.current,
}));

vi.mock("@/lib/auth/select-chapter", () => ({
  useSelectChapter: () => selectChapter,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

let activeChapterId: string | null = "chap-1";
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string | null }) => unknown) =>
    selector({ activeChapterId }),
}));

import { ChapterSwitcher } from "./chapter-switcher";

function membership(id: string, name: string, university = "Test University") {
  return { chapter_id: id, chapter: { id, name, university } };
}

/** Radix opens its dropdown on keydown; jsdom has no real PointerEvent. */
function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /Switch chapter/ }), {
    key: "Enter",
  });
}

describe("ChapterSwitcher", () => {
  beforeEach(() => {
    selectChapter.mockClear();
    selectChapter.mockResolvedValue(true);
    toast.mockClear();
    activeChapterId = "chap-1";
    chaptersQuery.current = { data: [], isSuccess: true };
  });

  it("renders nothing for a single-chapter user", () => {
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter")],
      isSuccess: true,
    };
    const { container } = render(<ChapterSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the chapter list is still loading", () => {
    chaptersQuery.current = { data: undefined as unknown as [], isSuccess: false };
    const { container } = render(<ChapterSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it("switches the active chapter when another chapter is picked", async () => {
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter"), membership("chap-2", "Beta Chapter")],
      isSuccess: true,
    };
    render(<ChapterSwitcher />);

    openMenu();
    const target = await screen.findByText("Beta Chapter");
    fireEvent.click(target);

    await waitFor(() => expect(selectChapter).toHaveBeenCalledWith("chap-2"));
    expect(toast).not.toHaveBeenCalled();
  });

  it("does not re-select the chapter the user is already in", async () => {
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter"), membership("chap-2", "Beta Chapter")],
      isSuccess: true,
    };
    render(<ChapterSwitcher />);

    openMenu();
    fireEvent.click(await screen.findByText("Alpha Chapter"));

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(selectChapter).not.toHaveBeenCalled();
  });

  it("surfaces a failed switch instead of silently staying put", async () => {
    selectChapter.mockResolvedValue(false);
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter"), membership("chap-2", "Beta Chapter")],
      isSuccess: true,
    };
    render(<ChapterSwitcher />);

    openMenu();
    fireEvent.click(await screen.findByText("Beta Chapter"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      ),
    );
  });

  it("offers a recovery path when the persisted chapter is no longer accessible", async () => {
    // Membership revoked, or a stale id left in localStorage by another
    // account on the same browser. Every request would 403 with no way out.
    activeChapterId = "chap-gone";
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter")],
      isSuccess: true,
    };
    render(<ChapterSwitcher />);

    expect(screen.getByText("Chapter unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Alpha Chapter" }));
    await waitFor(() => expect(selectChapter).toHaveBeenCalledWith("chap-1"));
  });

  it("prompts for a chapter when none is selected", () => {
    activeChapterId = null;
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter")],
      isSuccess: true,
    };
    render(<ChapterSwitcher />);

    expect(screen.getByText("No chapter selected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Alpha Chapter" }),
    ).toBeInTheDocument();
  });
});

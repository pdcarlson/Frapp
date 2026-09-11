import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/*
 * Ported from `chapter-switcher.spec.tsx`, which was deleted with its component
 * when the greenfield shell merged the chapter lockup and the switcher into one
 * 40px nav row. Every switching behavior below is the same contract the old
 * suite pinned; what changed is the trigger it hangs off, and the two cases
 * marked REVERSED, where the merge deliberately changed the answer.
 */

// A successful switch replaces the document; jsdom's real location.assign
// throws "not implemented", so stand in for it and assert the destination.
const assign = vi.fn();
Object.defineProperty(window, "location", {
  value: { ...window.location, assign },
  writable: true,
});

const { selectChapter, toast, chaptersQuery, currentChapterQuery } = vi.hoisted(
  () => ({
    selectChapter: vi.fn(async () => true),
    toast: vi.fn(),
    chaptersQuery: {
      current: { data: [] as unknown[], isSuccess: true },
    },
    currentChapterQuery: {
      current: { data: undefined as unknown, isError: false },
    },
  }),
);

vi.mock("@repo/hooks", () => ({
  useAccessibleChapters: () => chaptersQuery.current,
  useCurrentChapter: () => currentChapterQuery.current,
}));

vi.mock("@/lib/auth/select-chapter", () => ({
  useSelectChapter: () => selectChapter,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

let activeChapterId: string | null = "chap-1";
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId }),
}));

import { ChapterNavHeader } from "./chapter-nav-header";

function membership(id: string, name: string, university = "Test University") {
  return { chapter_id: id, chapter: { id, name, university } };
}

/** The shape `CurrentChapterPayloadSchema` parses, minimal but valid. */
function chapterPayload(name: string) {
  return {
    id: "chap-1",
    name,
    university: "Test University",
    subscription_status: "active",
  };
}

/** Radix opens its dropdown on keydown; jsdom has no real PointerEvent. */
function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /Chapter menu/ }), {
    key: "Enter",
  });
}

describe("ChapterNavHeader", () => {
  beforeEach(() => {
    selectChapter.mockClear();
    selectChapter.mockResolvedValue(true);
    assign.mockClear();
    toast.mockClear();
    activeChapterId = "chap-1";
    chaptersQuery.current = { data: [], isSuccess: true };
    currentChapterQuery.current = {
      data: chapterPayload("Alpha Chapter"),
      isError: false,
    };
  });

  // REVERSED from the old suite, which asserted `container` was empty here.
  // The switcher rendered nothing for a single-chapter user because the lockup
  // above it carried the identity. There is no lockup any more: this row IS the
  // chapter's identity, so it always renders.
  it("still renders the chapter row for a single-chapter user", () => {
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter")],
      isSuccess: true,
    };
    render(<ChapterNavHeader collapsed={false} />);
    expect(
      screen.getByRole("button", { name: /Chapter menu/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alpha Chapter")).toBeInTheDocument();
  });

  // REVERSED for the same reason: the row is identity, not a switch control.
  it("still renders the chapter row while the chapter list is loading", () => {
    chaptersQuery.current = {
      data: undefined as unknown as [],
      isSuccess: false,
    };
    render(<ChapterNavHeader collapsed={false} />);
    expect(
      screen.getByRole("button", { name: /Chapter menu/ }),
    ).toBeInTheDocument();
  });

  it("offers join and chapter settings even with one chapter", async () => {
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter")],
      isSuccess: true,
    };
    render(<ChapterNavHeader collapsed={false} />);

    openMenu();
    expect(await screen.findByText("Join another chapter")).toBeInTheDocument();
    expect(screen.getByText("Chapter settings")).toBeInTheDocument();
  });

  it("keeps chapter switching out of the account menu's job", async () => {
    // Identity and chapter are separate menus. The chapter row owns switching;
    // nothing here should offer Profile or Sign out.
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter")],
      isSuccess: true,
    };
    render(<ChapterNavHeader collapsed={false} />);

    openMenu();
    await screen.findByText("Chapter settings");
    expect(screen.queryByText("Sign out")).not.toBeInTheDocument();
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
  });

  it("hides the chapter name in the rail but keeps it as the accessible name", () => {
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter")],
      isSuccess: true,
    };
    render(<ChapterNavHeader collapsed />);

    expect(screen.queryByText("Alpha Chapter")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Alpha Chapter/ }),
    ).toBeInTheDocument();
  });

  it("switches the active chapter when another chapter is picked", async () => {
    chaptersQuery.current = {
      data: [
        membership("chap-1", "Alpha Chapter"),
        membership("chap-2", "Beta Chapter"),
      ],
      isSuccess: true,
    };
    render(<ChapterNavHeader collapsed={false} />);

    openMenu();
    const target = await screen.findByText("Beta Chapter");
    fireEvent.click(target);

    await waitFor(() => expect(selectChapter).toHaveBeenCalledWith("chap-2"));
    expect(toast).not.toHaveBeenCalled();
    // Reload into the root: chat's selected channel id and the realtime
    // subscriptions are keyed to the outgoing chapter, and the current route
    // may itself be chapter-scoped.
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });

  it("does not re-select the chapter the user is already in", async () => {
    chaptersQuery.current = {
      data: [
        membership("chap-1", "Alpha Chapter"),
        membership("chap-2", "Beta Chapter"),
      ],
      isSuccess: true,
    };
    render(<ChapterNavHeader collapsed={false} />);

    openMenu();
    // The menu lists the active chapter too, so target the menu item rather
    // than the trigger's own copy of the name.
    const items = await screen.findAllByText("Alpha Chapter");
    fireEvent.click(items[items.length - 1]!);

    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(selectChapter).not.toHaveBeenCalled();
  });

  it("surfaces a failed switch instead of silently staying put", async () => {
    selectChapter.mockResolvedValue(false);
    chaptersQuery.current = {
      data: [
        membership("chap-1", "Alpha Chapter"),
        membership("chap-2", "Beta Chapter"),
      ],
      isSuccess: true,
    };
    render(<ChapterNavHeader collapsed={false} />);

    openMenu();
    fireEvent.click(await screen.findByText("Beta Chapter"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      ),
    );
    // A failed switch must not navigate — the user is still in the old chapter.
    expect(assign).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Chapter menu/ }),
    ).toBeInTheDocument();
  });

  it("surfaces a thrown switch and stays put", async () => {
    selectChapter.mockRejectedValue(new Error("boom"));
    chaptersQuery.current = {
      data: [
        membership("chap-1", "Alpha Chapter"),
        membership("chap-2", "Beta Chapter"),
      ],
      isSuccess: true,
    };
    render(<ChapterNavHeader collapsed={false} />);

    openMenu();
    fireEvent.click(await screen.findByText("Beta Chapter"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      ),
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it("offers a recovery path when the persisted chapter is no longer accessible", async () => {
    // Membership revoked, or a stale id left in localStorage by another
    // account on the same browser. Every request would 403 with no way out.
    activeChapterId = "chap-gone";
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter")],
      isSuccess: true,
    };
    render(<ChapterNavHeader collapsed={false} />);

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
    render(<ChapterNavHeader collapsed={false} />);

    expect(screen.getByText("No chapter selected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Alpha Chapter" }),
    ).toBeInTheDocument();
  });
});

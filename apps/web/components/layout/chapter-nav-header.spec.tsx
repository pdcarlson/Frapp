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

const {
  selectChapter,
  toast,
  chaptersQuery,
  currentChapterQuery,
  permissionsQuery,
} = vi.hoisted(
  () => ({
    // An officer by default, so the "Chapter settings" link has somewhere to
    // go. `undefined` data is a permission read still in flight.
    permissionsQuery: {
      current: { data: { permissions: ["chapter-config:view"] } } as {
        data: { permissions: string[] } | undefined;
      },
    },
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
  useMyPermissions: () => permissionsQuery.current,
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

/** A minimal `GET /v1/chapters/current` payload. */
function chapterPayload(name: string) {
  return {
    id: "chap-1",
    name,
    university: "Test University",
    subscription_status: "active",
  };
}

/** Opens the menu the way a keyboard user does: Enter on the Radix trigger. */
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
    permissionsQuery.current = {
      data: { permissions: ["chapter-config:view"] },
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

  it("offers chapter settings only to a viewer Settings has something for", async () => {
    // It is the second door into Settings, so it asks the nav row's question
    // (#2946): an ordinary member would find nothing there they could use.
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter")],
      isSuccess: true,
    };
    permissionsQuery.current = {
      data: { permissions: ["members:view", "backwork:upload"] },
    };
    render(<ChapterNavHeader collapsed={false} />);

    openMenu();
    expect(await screen.findByText("Join another chapter")).toBeInTheDocument();
    expect(screen.queryByText("Chapter settings")).not.toBeInTheDocument();
  });

  it("drops chapter settings when a tools-only officer's tools are switched off", async () => {
    // A treasurer's only Settings destination is Reports. The link asks the
    // module gate too, or it would open onto an empty page once the chapter
    // turns Reports off.
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter")],
      isSuccess: true,
    };
    permissionsQuery.current = {
      data: { permissions: ["members:view", "reports:export"] },
    };
    currentChapterQuery.current = {
      data: { ...chapterPayload("Alpha Chapter"), enabled_modules: { reports: false } },
      isError: false,
    };
    const { unmount } = render(<ChapterNavHeader collapsed={false} />);
    openMenu();
    expect(await screen.findByText("Join another chapter")).toBeInTheDocument();
    expect(screen.queryByText("Chapter settings")).not.toBeInTheDocument();
    unmount();

    currentChapterQuery.current = {
      data: { ...chapterPayload("Alpha Chapter"), enabled_modules: { reports: true } },
      isError: false,
    };
    render(<ChapterNavHeader collapsed={false} />);
    openMenu();
    expect(await screen.findByText("Chapter settings")).toBeInTheDocument();
  });

  it("keeps offering chapter settings while permissions are still loading", async () => {
    chaptersQuery.current = {
      data: [membership("chap-1", "Alpha Chapter")],
      isSuccess: true,
    };
    permissionsQuery.current = { data: undefined };
    render(<ChapterNavHeader collapsed={false} />);

    openMenu();
    expect(await screen.findByText("Chapter settings")).toBeInTheDocument();
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

/**
 * The crest tile is the chapter mark (#2876). The beta chapter is a FIJI
 * chapter: its letters were autofilled from the directory, and by custom it
 * doesn't show them, which is the case that started this.
 */
describe("ChapterNavHeader chapter mark", () => {
  function withBranding(extra: Record<string, unknown>) {
    currentChapterQuery.current = {
      data: { ...chapterPayload("Tau Nu"), ...extra },
      isError: false,
    };
    render(<ChapterNavHeader collapsed />);
  }

  beforeEach(() => {
    activeChapterId = "chap-1";
    chaptersQuery.current = { data: [], isSuccess: true };
  });

  it("draws the logo when there is one", () => {
    withBranding({
      logo_url: "https://storage.example/logo.png",
      branding: { greek_letters: "ΦΓΔ", short_name: "FIJI" },
    });
    expect(screen.getByTestId("chapter-mark-logo")).toHaveAttribute(
      "src",
      "https://storage.example/logo.png",
    );
    expect(screen.queryByText("ΦΓΔ")).not.toBeInTheDocument();
  });

  it("falls back to the text mark when the logo fails to load", () => {
    withBranding({
      logo_url: "https://storage.example/expired.png",
      branding: { short_name: "FIJI" },
    });
    fireEvent.error(screen.getByTestId("chapter-mark-logo"));
    expect(screen.getByTestId("chapter-mark-text")).toHaveTextContent("FIJI");
  });

  it("shows the short name ahead of the Greek letters", () => {
    withBranding({ branding: { greek_letters: "ΦΓΔ", short_name: "FIJI" } });
    expect(screen.getByTestId("chapter-mark-text")).toHaveTextContent("FIJI");
  });

  it("never shows Greek letters the chapter turned off", () => {
    withBranding({
      branding: { greek_letters: "ΦΓΔ", show_greek_letters: false },
    });
    expect(screen.getByTestId("chapter-mark-text")).toHaveTextContent("TN");
    expect(screen.queryByText("ΦΓΔ")).not.toBeInTheDocument();
  });

  it("still shows Greek letters for a chapter that never touched the setting", () => {
    withBranding({ branding: { greek_letters: "ΣΦΕ" } });
    expect(screen.getByTestId("chapter-mark-text")).toHaveTextContent("ΣΦΕ");
  });

  /*
   * `branding` is jsonb, so a stored row can carry a value no schema would
   * pass. The row used to run the whole payload through a zod twin of the
   * contract, and one bad key failed it: the name read "Loading..." for good
   * and the crest drew "--" (#2844).
   */
  it("keeps the name and the mark when a key the mark doesn't read is malformed", () => {
    withBranding({
      branding: {
        short_name: "FIJI",
        founded_at: 1500,
        colors: { accent: "gold" },
      },
    });
    expect(
      screen.getByRole("button", { name: "Chapter menu (currently Tau Nu)" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("chapter-mark-text")).toHaveTextContent("FIJI");
  });

  it("falls past a malformed mark key to the next step", () => {
    withBranding({ branding: { short_name: 7, greek_letters: "ΦΓΔ" } });
    expect(screen.getByTestId("chapter-mark-text")).toHaveTextContent("ΦΓΔ");
  });
});

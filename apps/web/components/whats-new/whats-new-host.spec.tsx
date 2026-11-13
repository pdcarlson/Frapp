// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RELEASE_NOTES,
  formatReleaseNoteDate,
  releaseNoteVersion,
} from "@repo/validation";
import {
  WHATS_NEW_QUIET_STORAGE_KEY,
  WHATS_NEW_SEEN_STORAGE_KEY,
  resetWhatsNewForTests,
  useWhatsNewUnread,
} from "@/lib/whats-new";
import { WhatsNew } from "@/components/whats-new/whats-new";
import {
  WHATS_NEW_OPEN_DELAY_MS,
  WhatsNewHost,
} from "@/components/whats-new/whats-new-host";

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => <a {...props}>{children}</a>,
}));

const nav = vi.hoisted(() => ({ pathname: "/chat" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const data = vi.hoisted(() => ({
  user: undefined as { created_at?: string } | undefined,
  chapters: undefined as
    | { chapter_id: string; has_completed_onboarding: boolean }[]
    | undefined,
  account: { settled: true, seen: null } as {
    settled: boolean;
    seen: string | null | undefined;
  },
  recordOnAccount: vi.fn(),
}));
vi.mock("@repo/hooks", () => ({
  useCurrentUser: () => ({ data: data.user }),
  useAccessibleChapters: () => ({ data: data.chapters }),
  useAccountWhatsNewSeen: () => data.account,
  useRecordWhatsNewSeen: () => ({ mutate: data.recordOnAccount }),
}));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (state: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId: "chapter-1" }),
}));

const NEWEST = RELEASE_NOTES[0]!;
const OLDER = RELEASE_NOTES[1]!;
// Each entry shows its date over it, and dates are unique. Titles are not:
// every entry the fold starts is titled "New in this update" until someone
// rewords it, so two of those in a row would look like the same entry. The
// title is still checked where it should show.
const NEWEST_LABEL = formatReleaseNoteDate(NEWEST.date);
const OLDER_LABEL = formatReleaseNoteDate(OLDER.date);
const seen = () => window.localStorage.getItem(WHATS_NEW_SEEN_STORAGE_KEY);

function Unread() {
  return <output>{useWhatsNewUnread() ? "unread" : "read"}</output>;
}

// Hidden from the tree while the dialog is open, as the page behind it is.
const unreadMark = () => screen.getByRole("status", { hidden: true });

function renderHost() {
  return render(
    <>
      <WhatsNewHost />
      <Unread />
    </>,
  );
}

const wait = () =>
  act(() => {
    vi.advanceTimersByTime(WHATS_NEW_OPEN_DELAY_MS);
  });

describe("WhatsNewHost", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.localStorage.clear();
    resetWhatsNewForTests();
    nav.pathname = "/chat";
    data.user = { created_at: "2026-01-01T00:00:00.000Z" };
    data.chapters = [
      { chapter_id: "chapter-1", has_completed_onboarding: true },
    ];
    data.account = { settled: true, seen: null };
    data.recordOnAccount.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("opens the entries newer than the one this browser last showed, and records the newest", () => {
    window.localStorage.setItem(
      WHATS_NEW_SEEN_STORAGE_KEY,
      releaseNoteVersion(OLDER),
    );
    renderHost();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(unreadMark()).toHaveTextContent("unread");

    wait();
    const dialog = screen.getByRole("dialog", { name: "What's new" });
    expect(dialog).toHaveTextContent(NEWEST_LABEL);
    expect(dialog).toHaveTextContent(NEWEST.title);
    expect(dialog).not.toHaveTextContent(OLDER_LABEL);
    expect(seen()).toBe(releaseNoteVersion(NEWEST));
    expect(unreadMark()).toHaveTextContent("read");
  });

  it("shows only the newest entry to an older account on a browser with no marker", () => {
    renderHost();
    wait();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(NEWEST_LABEL);
    expect(dialog).toHaveTextContent(NEWEST.title);
    expect(dialog).not.toHaveTextContent(OLDER_LABEL);
  });

  it("closes by Esc, the X and See all updates, and doesn't come back", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = renderHost();
    wait();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    // A reload: the marker holds, so nothing opens.
    const reloaded = renderHost();
    wait();
    expect(screen.queryByRole("dialog")).toBeNull();
    reloaded.unmount();

    window.localStorage.clear();
    const second = renderHost();
    wait();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    second.unmount();

    window.localStorage.clear();
    renderHost();
    wait();
    const all = screen.getByRole("link", { name: "See all updates" });
    expect(all).toHaveAttribute("href", "/whats-new");
    await user.click(all);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows nothing once the newest entry is recorded", () => {
    window.localStorage.setItem(
      WHATS_NEW_SEEN_STORAGE_KEY,
      releaseNoteVersion(NEWEST),
    );
    renderHost();
    wait();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(unreadMark()).toHaveTextContent("read");
  });

  it("records without showing for an account made since the newest entry", () => {
    data.user = { created_at: `${NEWEST.date}T12:00:00.000Z` };
    renderHost();
    wait();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(seen()).toBe(releaseNoteVersion(NEWEST));
    expect(unreadMark()).toHaveTextContent("read");
  });

  it("records without showing while the first-run tour is due", () => {
    data.chapters = [
      { chapter_id: "chapter-1", has_completed_onboarding: false },
    ];
    renderHost();
    wait();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(seen()).toBe(releaseNoteVersion(NEWEST));
  });

  it("decides nothing for a member with no chapter, whom the chapter wizard owns", () => {
    data.chapters = [];
    renderHost();
    wait();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(seen()).toBeNull();
  });

  it.each(["dialog", "alertdialog", "menu", "listbox"])(
    "stands down while a %s is up, stays unread, and opens after the next navigation",
    (role) => {
      const other = document.createElement("div");
      other.setAttribute("role", role);
      document.body.appendChild(other);
      const view = renderHost();
      wait();
      expect(screen.queryByRole("dialog", { name: "What's new" })).toBeNull();
      expect(seen()).toBeNull();
      expect(unreadMark()).toHaveTextContent("unread");

      other.remove();
      nav.pathname = "/events";
      view.rerender(
        <>
          <WhatsNewHost />
          <Unread />
        </>,
      );
      wait();
      expect(screen.getByRole("dialog", { name: "What's new" })).toBeVisible();
    },
  );

  it("closes on a click outside", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHost();
    wait();
    // Radix marks the scrim as the outside; a pointer down there dismisses.
    await user.click(document.querySelector('[data-state="open"].fixed.inset-0')!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clears the mark and records the entry once the What's new page is read", () => {
    nav.pathname = "/billing";
    const view = renderHost();
    wait();
    expect(unreadMark()).toHaveTextContent("unread");
    const page = render(<WhatsNew />);
    expect(unreadMark()).toHaveTextContent("read");
    expect(seen()).toBe(releaseNoteVersion(NEWEST));
    page.unmount();
    view.unmount();
  });

  it("never opens over checkout or the What's new page itself", () => {
    for (const pathname of ["/billing", "/settings", "/whats-new"]) {
      nav.pathname = pathname;
      const view = renderHost();
      wait();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(seen()).toBeNull();
      view.unmount();
      resetWhatsNewForTests();
    }
  });

  it("shows nothing if the notes were read on the page before it could open", () => {
    nav.pathname = "/whats-new";
    const view = renderHost();
    wait();
    // What the page's own marker does.
    window.localStorage.setItem(
      WHATS_NEW_SEEN_STORAGE_KEY,
      releaseNoteVersion(NEWEST),
    );
    nav.pathname = "/chat";
    view.rerender(
      <>
        <WhatsNewHost />
        <Unread />
      </>,
    );
    wait();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(unreadMark()).toHaveTextContent("read");
  });

  describe("across devices (#4043)", () => {
    const quietKey = () =>
      window.localStorage.getItem(WHATS_NEW_QUIET_STORAGE_KEY);

    it("tells the account when it opens the notes", () => {
      renderHost();
      wait();
      expect(screen.getByRole("dialog")).toBeVisible();
      expect(data.recordOnAccount).toHaveBeenCalledWith(
        releaseNoteVersion(NEWEST),
      );
    });

    it("doesn't open what another device already showed: it marks the row until What's new is opened", () => {
      data.account = { settled: true, seen: releaseNoteVersion(NEWEST) };
      const view = renderHost();
      wait();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(seen()).toBe(releaseNoteVersion(NEWEST));
      expect(unreadMark()).toHaveTextContent("unread");
      view.unmount();

      // A reload keeps the mark, and still opens nothing.
      resetWhatsNewForTests();
      const reloaded = renderHost();
      wait();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(unreadMark()).toHaveTextContent("unread");

      const page = render(<WhatsNew />);
      expect(unreadMark()).toHaveTextContent("read");
      expect(quietKey()).toBeNull();
      // Reading the page tells the account too.
      expect(data.recordOnAccount).toHaveBeenCalledWith(
        releaseNoteVersion(NEWEST),
      );
      page.unmount();
      reloaded.unmount();
    });

    it("drops a quiet mark the signed-in account doesn't back (another account's)", () => {
      window.localStorage.setItem(
        WHATS_NEW_SEEN_STORAGE_KEY,
        releaseNoteVersion(NEWEST),
      );
      window.localStorage.setItem(
        WHATS_NEW_QUIET_STORAGE_KEY,
        releaseNoteVersion(NEWEST),
      );
      data.account = { settled: true, seen: null };
      renderHost();
      wait();
      expect(unreadMark()).toHaveTextContent("read");
      expect(quietKey()).toBeNull();
    });

    it("keeps a quiet mark offline, when the account can't say", () => {
      window.localStorage.setItem(
        WHATS_NEW_SEEN_STORAGE_KEY,
        releaseNoteVersion(NEWEST),
      );
      window.localStorage.setItem(
        WHATS_NEW_QUIET_STORAGE_KEY,
        releaseNoteVersion(NEWEST),
      );
      data.account = { settled: true, seen: undefined };
      renderHost();
      wait();
      expect(unreadMark()).toHaveTextContent("unread");
    });

    it("still opens when the account saw only an older entry", () => {
      data.account = { settled: true, seen: releaseNoteVersion(OLDER) };
      renderHost();
      wait();
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent(NEWEST_LABEL);
      expect(dialog).toHaveTextContent(NEWEST.title);
    });

    it("waits for the account, then goes by this browser's marker when it can't be read", () => {
      data.account = { settled: false, seen: undefined };
      const view = renderHost();
      wait();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(seen()).toBeNull();

      data.account = { settled: true, seen: undefined };
      view.rerender(
        <>
          <WhatsNewHost />
          <Unread />
        </>,
      );
      wait();
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent(NEWEST_LABEL);
      expect(dialog).toHaveTextContent(NEWEST.title);
    });

    it("keeps the no-show cases: a new account records without a mark", () => {
      data.user = { created_at: `${NEWEST.date}T12:00:00.000Z` };
      data.account = { settled: true, seen: releaseNoteVersion(NEWEST) };
      renderHost();
      wait();
      expect(unreadMark()).toHaveTextContent("read");
      expect(quietKey()).toBeNull();
    });
  });
});

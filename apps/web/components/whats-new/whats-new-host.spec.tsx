// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASE_NOTES, releaseNoteVersion } from "@repo/validation";
import {
  WHATS_NEW_SEEN_STORAGE_KEY,
  resetWhatsNewForTests,
  useWhatsNewUnread,
} from "@/lib/whats-new";
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
}));
vi.mock("@repo/hooks", () => ({
  useCurrentUser: () => ({ data: data.user }),
  useAccessibleChapters: () => ({ data: data.chapters }),
}));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (state: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId: "chapter-1" }),
}));

const NEWEST = RELEASE_NOTES[0]!;
const OLDER = RELEASE_NOTES[1]!;
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
    expect(dialog).toHaveTextContent(NEWEST.title);
    expect(dialog).not.toHaveTextContent(OLDER.title);
    expect(seen()).toBe(releaseNoteVersion(NEWEST));
    expect(unreadMark()).toHaveTextContent("read");
  });

  it("shows only the newest entry to an older account on a browser with no marker", () => {
    renderHost();
    wait();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(NEWEST.title);
    expect(dialog).not.toHaveTextContent(OLDER.title);
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

  it("stands down while another dialog or menu is up, stays unread, and opens after the next navigation", () => {
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
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
  });

  it("never opens over checkout or the What's new page itself", () => {
    for (const pathname of ["/billing", "/whats-new"]) {
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
});

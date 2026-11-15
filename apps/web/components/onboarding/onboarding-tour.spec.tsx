import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const { state, updateOnboarding, toast, setPicked } = vi.hoisted(() => ({
  state: {
    pathname: "/chat",
    completed: false,
    termsRequired: false,
    roles: [] as Array<{
      id: string;
      name: string;
      held: boolean;
      joinable: boolean;
      color: null;
    }>,
  },
  updateOnboarding: { mutateAsync: vi.fn(), isPending: false },
  toast: vi.fn(),
  setPicked: { mutateAsync: vi.fn() },
}));

vi.mock("@repo/hooks", () => ({
  useAccessibleChapters: () => ({
    data: [
      {
        chapter_id: "chapter-1",
        has_completed_onboarding: state.completed,
        chapter: { name: "Tau Nu" },
      },
    ],
  }),
  useCurrentChapter: () => ({ data: { name: "Tau Nu" } }),
  useLegalAcceptance: () => ({ data: { required: state.termsRequired } }),
  useViewerUserId: () => "user-1",
  useUpdateOnboarding: () => updateOnboarding,
  usePickableRoles: () => ({ roles: state.roles, isLoading: false }),
  useSetPickedRole: () => setPicked,
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chapter-1" }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { OnboardingTour } from "./onboarding-tour";
import { replayTour, tourStorageKey } from "./tour";

const STORAGE_KEY = tourStorageKey("user-1", "chapter-1");

/**
 * The Chat screen's anchors, laid out as the dashboard draws them at 1024px
 * (jsdom measures everything 0×0, so each carries its own box).
 */
function ChatScreen({
  sidebar = true,
  direct = true,
  list = true,
}: {
  sidebar?: boolean;
  direct?: boolean;
  /** False: below the side-by-side width, on a channel, the list one step back. */
  list?: boolean;
}) {
  return (
    <>
      {list ? (
        <div data-box="0,48,240,500" data-channel-list="channels" />
      ) : (
        <button
          aria-label="Back to channels"
          data-box="8,56,32,32"
          type="button"
        />
      )}
      <div data-box="240,48,784,700" id="chat-timeline" />
      {sidebar ? (
        <>
          <div data-box="0,120,200,200" data-nav-section="chapter" />
          {direct ? (
            <a data-box="0,80,200,34" data-nav-item="direct" href="#dm">
              Direct messages
            </a>
          ) : null}
        </>
      ) : (
        <button data-box="8,8,44,44" data-nav-trigger="" type="button" />
      )}
      <button data-box="980,8,30,30" data-account-menu="" type="button" />
      <OnboardingTour />
    </>
  );
}

function measuredBox(this: Element): DOMRect {
  const raw = this.getAttribute("data-box");
  const [x, y, w, h] = raw ? raw.split(",").map(Number) : [0, 0, 0, 0];
  return {
    left: x,
    top: y,
    width: w,
    height: h,
    x,
    y,
    right: x! + w!,
    bottom: y! + h!,
  } as DOMRect;
}

const realRect = Element.prototype.getBoundingClientRect;
const realOffset = {
  width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
  height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
};

beforeEach(() => {
  Element.prototype.getBoundingClientRect = measuredBox;
  // The coach mark is measured before it is placed; jsdom lays nothing out.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 320,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 160,
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
});

afterEach(() => {
  // Unmount while the frame stub is still in place, so the tour's loop is
  // cancelled through it rather than left to fire after teardown.
  cleanup();
  Element.prototype.getBoundingClientRect = realRect;
  if (realOffset.width)
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", realOffset.width);
  if (realOffset.height)
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffset.height);
  vi.unstubAllGlobals();
  window.localStorage.clear();
  state.pathname = "/chat";
  state.completed = false;
  state.termsRequired = false;
  state.roles = [];
  updateOnboarding.mutateAsync.mockReset();
  toast.mockReset();
});

const tour = () => screen.findByRole("dialog");
/** The tour's layer, shown or still being placed: what "never opens" means. */
const tourLayer = () => document.querySelector("[data-onboarding-tour]");
/** Long enough for the tour to start, place its card and show it. */
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 400)));
const joinable = () => [
  { id: "im", name: "Intramurals", held: false, joinable: true, color: null },
];
const line = async () =>
  (await tour()).querySelector("[id^='tour-text-']")!.textContent;
const next = async () =>
  fireEvent.click(within(await tour()).getByRole("button", { name: "Next" }));

async function stopLines(): Promise<string[]> {
  const lines: string[] = [];
  for (;;) {
    const dialog = await tour();
    const text = await line();
    if (lines.at(-1) !== text) lines.push(text!);
    const done = within(dialog).queryByRole("button", { name: "Done" });
    if (done) return lines;
    await next();
    await waitFor(async () => expect(await line()).not.toBe(text));
  }
}

describe("the stops", () => {
  it("runs the five stops over the real controls, in order", async () => {
    render(<ChatScreen />);
    expect(await screen.findByText("1 of 5")).toBeInTheDocument();
    expect(await stopLines()).toEqual([
      "You're in Tau Nu. These are the chapter's channels. Click one to start talking.",
      "Choose how messages look on this browser. You can change it anytime in Settings.",
      "Events, points, study hours and the rest of the chapter are here, under Chapter.",
      "Direct messages are here.",
      "Your profile and settings are here. Replay this tour anytime from Settings → Account.",
    ]);
    expect(screen.getByText("5 of 5")).toBeInTheDocument();
  });

  it("adds Pick your roles after the display stop with a role to join", async () => {
    state.roles = [
      { id: "im", name: "Intramurals", held: false, joinable: true, color: null },
    ];
    render(<ChatScreen />);
    expect(await screen.findByText("1 of 6")).toBeInTheDocument();
    await next();
    await screen.findByText("2 of 6");
    await next();
    expect(
      await screen.findByRole("heading", { name: "Pick your roles" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Intramurals")).toBeInTheDocument();
  });

  it("skips a stop whose control isn't on screen", async () => {
    render(<ChatScreen direct={false} />);
    expect(await screen.findByText("1 of 4")).toBeInTheDocument();
    const lines = await stopLines();
    expect(lines).not.toContain("Direct messages are here.");
    expect(lines).toHaveLength(4);
  });

  it("points the sidebar stops at the menu button below lg", async () => {
    render(<ChatScreen sidebar={false} />);
    const lines = await stopLines();
    expect(lines).toContain(
      "Events, points, study hours and the rest of the chapter are in this menu, under Chapter.",
    );
    expect(lines).toContain("Direct messages are in this menu too.");
  });

  it("saves the display pick on the click", async () => {
    render(<ChatScreen />);
    await next();
    const compact = await screen.findByRole("radio", { name: "Compact" });
    fireEvent.click(compact);
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Compact" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(window.localStorage.getItem("frapp.chat-density.v1")).toBe("compact");
  });
});

describe("pausing", () => {
  it("pauses on Escape and resumes at the same stop next visit", async () => {
    const { unmount } = render(<ChatScreen />);
    await next();
    await screen.findByText("2 of 5");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateOnboarding.mutateAsync).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("display");
    unmount();

    render(<ChatScreen />);
    expect(await screen.findByText("2 of 5")).toBeInTheDocument();
  });

  it("pauses on a click on the dim, and not on the lit control", async () => {
    render(<ChatScreen />);
    await tour();
    fireEvent.click(document.querySelector("[data-tour-scrim]")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateOnboarding.mutateAsync).not.toHaveBeenCalled();
  });

  it("pauses on leaving Chat, and stays down for the visit", async () => {
    const { rerender } = render(<ChatScreen />);
    await tour();
    state.pathname = "/events";
    rerender(<ChatScreen />);
    expect(screen.queryByRole("dialog")).toBeNull();
    state.pathname = "/chat";
    rerender(<ChatScreen />);
    await settle();
    expect(tourLayer()).toBeNull();
    expect(updateOnboarding.mutateAsync).not.toHaveBeenCalled();
  });

  it("doesn't pause on an Escape a menu in the spot already handled", async () => {
    render(<ChatScreen />);
    await tour();
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    escape.preventDefault();
    act(() => {
      document.dispatchEvent(escape);
    });
    await settle();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("comes back from its first stop on Replay tour, in the same visit", async () => {
    render(<ChatScreen />);
    await next();
    await screen.findByText("2 of 5");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(tourLayer()).toBeNull());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("display");

    act(() => replayTour("user-1", "chapter-1"));
    expect(await screen.findByText("1 of 5")).toBeInTheDocument();
    expect(await line()).toMatch(/^You're in Tau Nu\./);
  });
});

describe("Pick your roles", () => {
  it("is settled as the member moves past the display stop", async () => {
    const { rerender } = render(<ChatScreen />);
    await next();
    await screen.findByText("2 of 5");
    await next();
    await screen.findByText("3 of 5");
    // The roles read lands late, behind the member: the tour stays put.
    state.roles = joinable();
    rerender(<ChatScreen />);
    await settle();
    expect(screen.getByText("3 of 5")).toBeInTheDocument();
    expect(await line()).toMatch(/under Chapter\.$/);
  });

  it("joins while still ahead of the member", async () => {
    const { rerender } = render(<ChatScreen />);
    expect(await screen.findByText("1 of 5")).toBeInTheDocument();
    state.roles = joinable();
    rerender(<ChatScreen />);
    expect(await screen.findByText("1 of 6")).toBeInTheDocument();
  });

  it("leaves a paused roles stop out once no role is joinable", async () => {
    window.localStorage.setItem(STORAGE_KEY, "roles");
    render(<ChatScreen />);
    expect(await line()).toMatch(/under Chapter\.$/);
    expect(screen.getByText("3 of 5")).toBeInTheDocument();
  });

  it("points at the back-to-channels button when the list is a step back", async () => {
    state.roles = joinable();
    render(<ChatScreen list={false} />);
    expect(await screen.findByText("1 of 6")).toBeInTheDocument();
    await next();
    await screen.findByText("2 of 6");
    await next();
    expect(
      await screen.findByRole("heading", { name: "Pick your roles" }),
    ).toBeInTheDocument();
  });
});

describe("finishing", () => {
  it("Done ends it for good, with no toast", async () => {
    render(<ChatScreen />);
    await stopLines();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateOnboarding.mutateAsync).toHaveBeenCalledWith({
      has_completed_onboarding: true,
    });
    expect(toast).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("Skip tour ends it and says where to replay it", async () => {
    render(<ChatScreen />);
    fireEvent.click(
      within(await tour()).getByRole("button", { name: "Skip tour" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateOnboarding.mutateAsync).toHaveBeenCalledWith({
      has_completed_onboarding: true,
    });
    expect(toast).toHaveBeenCalledWith({
      title: "Tour skipped",
      description: "Replay it anytime from Settings → Account.",
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("where it never opens", () => {
  it("opens, as the control for the cases below", async () => {
    render(<ChatScreen />);
    await settle();
    expect(tourLayer()).not.toBeNull();
  });

  it("not over the Terms prompt", async () => {
    state.termsRequired = true;
    render(<ChatScreen />);
    await settle();
    expect(tourLayer()).toBeNull();
  });

  it("not on the checkout landings, or anywhere but Chat", async () => {
    state.pathname = "/settings/chapter/billing";
    render(<ChatScreen />);
    await settle();
    expect(tourLayer()).toBeNull();
  });

  it("not once onboarding is complete", async () => {
    state.completed = true;
    render(<ChatScreen />);
    await settle();
    expect(tourLayer()).toBeNull();
  });
});

describe("focus", () => {
  // jsdom lets a `visibility: hidden` element take focus, which a browser
  // doesn't, so this pins that the card is focused at all; the wait for the
  // card to be placed first (`measured`) was checked in a browser.
  it("takes the first stop's card into focus", async () => {
    render(<ChatScreen />);
    const dialog = await tour();
    await waitFor(() => expect(document.activeElement).toBe(dialog));
  });
});

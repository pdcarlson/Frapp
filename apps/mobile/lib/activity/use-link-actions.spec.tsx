/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { Alert } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useRouter } from "expo-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "@repo/hooks";

/**
 * The sign-up link writes (#5779 moved them off Activity to a channel's
 * Links): each write's Undo, a failure's alert and Try again, and where Open
 * and Open in chat go. The channel's own wiring is pinned in
 * `lib/chat/chat-thread-screen.spec.tsx`.
 */

const links = vi.hoisted(() => ({
  permissions: [] as string[],
  done: vi.fn(),
  hidden: vi.fn(),
  clear: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMyPermissions: () => ({ data: { permissions: links.permissions } }),
  useSetActivityLinkState: (state: "done" | "hidden") => ({
    mutateAsync: state === "done" ? links.done : links.hidden,
  }),
  useClearActivityLinkState: () => ({ mutateAsync: links.clear }),
  useRemoveActivityLink: () => ({ mutateAsync: links.remove }),
  useRestoreActivityLink: () => ({ mutateAsync: links.restore }),
}));

const openLink = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat/open-link", () => ({ openMessageLink: openLink }));

import { useLinkActions } from "./use-link-actions";

type LinkRow = Extract<ActivityRow, { kind: "link" }>;
type Result = ReturnType<typeof useLinkActions>;

const link = (overrides: Record<string, unknown> = {}) =>
  ({
    kind: "link",
    key: "link:l1",
    title: "Google Form",
    link: {
      id: "l1",
      url: "https://forms.gle/abc",
      message_id: "m1",
      thread_root_id: null,
      channel_id: "chan-1",
      ...overrides,
    },
  }) as unknown as LinkRow;

const latest: { value: Result | null } = { value: null };
const mounted: ReactTestRenderer[] = [];

function Harness({
  openInChat,
  report,
}: {
  openInChat?: (row: LinkRow) => void;
  report: (result: Result) => void;
}) {
  report(useLinkActions({ openInChat }));
  return null;
}

function render(openInChat?: (row: LinkRow) => void) {
  act(() => {
    mounted.push(
      create(
        <Harness
          openInChat={openInChat}
          report={(result) => {
            latest.value = result;
          }}
        />,
      ),
    );
  });
  return () => latest.value!;
}

beforeEach(() => {
  links.permissions = [];
  for (const write of [
    links.done,
    links.hidden,
    links.clear,
    links.remove,
    links.restore,
  ]) {
    write.mockReset();
    write.mockResolvedValue(undefined);
  }
  openLink.mockClear();
  vi.mocked(useRouter().push).mockClear();
});

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useLinkActions", () => {
  it.each([
    ["done", "Marked done", "clear"],
    ["hide", "Hidden", "clear"],
    ["remove", "Removed for everyone", "restore"],
  ] as const)(
    "offers Undo once %s lands, and Undo takes it back with the matching write",
    async (action, message, takeBack) => {
      const result = render();
      await act(async () => {
        result().linkActions[action](link());
      });
      const write = {
        done: links.done,
        hide: links.hidden,
        remove: links.remove,
      }[action];
      expect(write).toHaveBeenCalledWith("l1");
      expect(result().undo?.message).toBe(message);
      await act(async () => {
        result().undo!.run();
      });
      expect(links[takeBack]).toHaveBeenCalledWith("l1");
      expect(result().undo).toBeNull();
    },
  );

  it("lets the Undo window run out", async () => {
    vi.useFakeTimers();
    const result = render();
    await act(async () => {
      result().linkActions.done(link());
    });
    expect(result().undo).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result().undo).toBeNull();
  });

  it("says a failed write with the platform alert, offers no Undo, and Try again sends it again", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    links.hidden.mockRejectedValueOnce(new TypeError("Network request failed"));
    const result = render();
    await act(async () => {
      result().linkActions.hide(link());
    });
    expect(alert).toHaveBeenCalledWith("Couldn't hide it", expect.any(String), [
      expect.objectContaining({ text: "Not now" }),
      expect.objectContaining({ text: "Try again" }),
    ]);
    expect(result().undo).toBeNull();
    const buttons = alert.mock.calls[0]![2] as { onPress?: () => void }[];
    await act(async () => {
      buttons[1]!.onPress!();
    });
    expect(links.hidden).toHaveBeenCalledTimes(2);
    expect(links.hidden).toHaveBeenLastCalledWith("l1");
    expect(result().undo?.message).toBe("Hidden");
  });

  it("lets only a channels:manage holder remove one for everyone", () => {
    expect(render()().linkActions.canRemove).toBe(false);
    links.permissions = ["channels:manage"];
    expect(render()().linkActions.canRemove).toBe(true);
  });

  it("opens the link in the in-app browser", () => {
    const result = render();
    act(() => result().linkActions.open(link()));
    expect(openLink).toHaveBeenCalledWith("https://forms.gle/abc");
  });

  it("opens a thread reply in its thread, and a channel message in its channel, by default", () => {
    const result = render();
    const push = vi.mocked(useRouter().push);
    act(() =>
      result().linkActions.openInChat(link({ thread_root_id: "root-1" })),
    );
    expect(push).toHaveBeenLastCalledWith({
      pathname: "/chat-thread",
      params: { channelId: "chan-1", threadRootId: "root-1" },
    });
    act(() => result().linkActions.openInChat(link()));
    expect(push).toHaveBeenLastCalledWith({
      pathname: "/chat-thread",
      params: { channelId: "chan-1" },
    });
  });

  it("takes a screen's own Open in chat in place of the push", () => {
    const openInChat = vi.fn();
    const result = render(openInChat);
    act(() => result().linkActions.openInChat(link()));
    expect(openInChat).toHaveBeenCalledWith(link());
    expect(vi.mocked(useRouter().push)).not.toHaveBeenCalled();
  });
});

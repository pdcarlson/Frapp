/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { plusMenuModel, type PlusMenuContext } from "@repo/chat-core/plus-menu";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import { ComposerPlusSheet } from "./composer-plus-sheet";
import {
  plusModuleStatus,
  presentEventOutcome,
  presentPostOutcome,
} from "./use-composer-plus";

function ctx(overrides: Partial<PlusMenuContext> = {}): PlusMenuContext {
  return {
    forms: [
      { command: "poll", roleAllows: true },
      { command: "event", roleAllows: true },
      { command: "task", roleAllows: false },
      { command: "hours", roleAllows: true },
    ],
    moduleStatus: "ready",
    isModuleEnabled: () => true,
    replying: false,
    attachmentNoun: "photo",
    attachmentsStaged: 0,
    attachmentLimit: 10,
    offline: false,
    roleRetryHint: "Close this and try again.",
    ...overrides,
  };
}

const dismiss = vi.fn();

function render(
  context: PlusMenuContext,
  props: { photoDisabledReason?: string | null } = {},
) {
  const onPhoto = vi.fn();
  const onOpenForm = vi.fn();
  const ref = React.createRef<never>();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ComposerPlusSheet
          ref={ref}
          model={plusMenuModel(context)}
          photoDisabledReason={props.photoDisabledReason ?? null}
          onPhoto={onPhoto}
          onOpenForm={onOpenForm}
        />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal"
            ? { dismiss, present: vi.fn() }
            : null,
      },
    );
  });
  return { tree, onPhoto, onOpenForm };
}

const row = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      String(node.props.accessibilityLabel).startsWith(label),
  );

const finishClosing = (tree: ReactTestRenderer) =>
  act(() =>
    tree.root
      .find((node) => node.type === ("BottomSheetModal" as never))
      .props.onDismiss(),
  );

describe("ComposerPlusSheet (#3865)", () => {
  it("lists Photo, then what the role may use, with the why line for the rest", () => {
    const { tree } = render(ctx());
    const labels = tree.root
      .findAll(
        (node) =>
          node.type === ("Pressable" as never) &&
          node.props.accessibilityRole === "button" &&
          node.props.accessibilityLabel !== "Cancel",
      )
      .map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(
      expect.arrayContaining(["Photo", "Poll", "Event", "Service hours"]),
    );
    expect(labels).not.toContain("Task");
    expect(screenText(tree)).toContain("Your role can't create tasks.");
  });

  it("greys a row that can't work this second, and reads its reason with it", () => {
    const { tree } = render(ctx({ offline: true }), {
      photoDisabledReason: "Reconnect first",
    });
    const event = row(tree, "Event");
    expect(event.props.disabled).toBe(true);
    expect(event.props.accessibilityLabel).toBe("Event, Reconnect first");
    expect(row(tree, "Photo").props.disabled).toBe(true);
    // A poll queues like a message.
    expect(row(tree, "Poll").props.disabled).toBe(false);
  });

  it("greys Photo at the tray's limit", () => {
    const { tree } = render(ctx({ attachmentsStaged: 10 }));
    expect(row(tree, "Photo").props.accessibilityLabel).toBe(
      "Photo, Up to 10 photos",
    );
  });

  it("opens the chosen form only once the sheet has closed", () => {
    dismiss.mockClear();
    const { tree, onOpenForm } = render(ctx());
    act(() => row(tree, "Event").props.onPress());
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(onOpenForm).not.toHaveBeenCalled();
    finishClosing(tree);
    expect(onOpenForm).toHaveBeenCalledWith("event");
    // A later close (a swipe) runs nothing again.
    finishClosing(tree);
    expect(onOpenForm).toHaveBeenCalledTimes(1);
  });

  it("opens the photo library the same way", () => {
    const { tree, onPhoto } = render(ctx());
    act(() => row(tree, "Photo").props.onPress());
    finishClosing(tree);
    expect(onPhoto).toHaveBeenCalledTimes(1);
  });
});

describe("plusModuleStatus", () => {
  it("trusts a cached chapter, then says why there's none", () => {
    expect(
      plusModuleStatus({ hasData: true, fetchStatus: "idle", offline: true }),
    ).toBe("ready");
    expect(
      plusModuleStatus({ hasData: false, fetchStatus: "idle", offline: true }),
    ).toBe("offline");
    expect(
      plusModuleStatus({
        hasData: false,
        fetchStatus: "fetching",
        offline: false,
      }),
    ).toBe("loading");
    expect(
      plusModuleStatus({ hasData: false, fetchStatus: "idle", offline: false }),
    ).toBe("error");
  });
});

describe("presentPostOutcome", () => {
  it("says nothing for a plain post: the card is the confirmation", () => {
    const alert = vi.fn();
    presentPostOutcome("task", { ok: true } as never, alert);
    expect(alert).not.toHaveBeenCalled();
  });

  it("titles a lost answer as unconfirmed, never as failed", () => {
    const alert = vi.fn();
    presentPostOutcome(
      "hours",
      { unconfirmed: true, warning: "Check the Service page." },
      alert,
    );
    expect(alert).toHaveBeenCalledWith(
      "Couldn't confirm the hours",
      "Check the Service page.",
    );
  });

  it("titles a write whose card didn't post as done", () => {
    const alert = vi.fn();
    presentPostOutcome("task", { warning: "The card didn't post." }, alert);
    expect(alert).toHaveBeenCalledWith("Task created", "The card didn't post.");
  });
});

describe("presentEventOutcome", () => {
  it("says where the card went when it isn't in the thread", () => {
    const alert = vi.fn();
    presentEventOutcome(
      { name: "Formal", cardKeptOut: true, cardLost: false },
      alert,
    );
    presentEventOutcome(
      { name: "Formal", cardKeptOut: false, cardLost: true },
      alert,
    );
    presentEventOutcome(
      { name: "Formal", cardKeptOut: false, cardLost: false },
      alert,
    );
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[0]![1]).toMatch(/only for some roles/);
    expect(alert.mock.calls[1]![1]).toMatch(/couldn't be posted in chat/);
  });
});

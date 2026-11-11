/** @vitest-environment jsdom */
import React, { createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { AccessibilityInfo, Alert, Keyboard } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { SheetHeader } from "@/components/sheet-scaffold";

// The report settles in a microtask after the press, so its state update lands
// inside an async `act`; React only accepts that when told this is a test env.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const report = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));
const blockActions = vi.hoisted(() => ({
  block: vi.fn(),
  unblock: vi.fn(),
  isPending: false,
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return { ...actual, useReportMessage: () => report };
});

vi.mock("@/lib/chat/block-actions", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/chat/block-actions")
  >("@/lib/chat/block-actions");
  return { ...actual, useBlockActions: () => blockActions };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

import * as Clipboard from "expo-clipboard";
import {
  COPIED_LABEL,
  MessageActionsSheet,
  QUICK_REACTIONS,
  quickReactionLabel,
  type MessageActionsSheetHandle,
  type MessageActionsTarget,
} from "./message-actions-sheet";
import {
  BLOCK_NOT_A_MEMBER_BODY,
  blockConfirmBody,
} from "@repo/chat-core/block-copy";
import {
  REPORT_ALREADY_BODY,
  REPORT_FAILED_BODY,
  REPORT_FAILED_TITLE,
  REPORT_SENT_BODY,
  REPORT_SENT_TITLE,
  REPORT_UNAVAILABLE_BODY,
} from "@repo/chat-core/report-copy";

const BLOCKED = "22222222-2222-4222-8222-222222222222";

/** Someone else's message, in a channel the viewer can't reply in. */
const SOMEONE_ELSES = {
  canReply: false,
  canEdit: false,
  canDelete: false,
  canReport: true,
} as const;

function render(
  target: MessageActionsTarget | null,
  onSenderDeparted?: (userId: string) => void,
  handlers: {
    onReply?: (messageId: string) => void;
    onStartThread?: (messageId: string) => void;
    onEdit?: (messageId: string) => void;
    onDelete?: (messageId: string) => void;
    onMention?: (messageId: string) => void;
  } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageActionsSheet
          ref={createRef<MessageActionsSheetHandle>()}
          target={target}
          onSenderDeparted={onSenderDeparted}
          {...handlers}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function text(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function pressByLabel(tree: ReactTestRenderer, label: string) {
  const node = tree.root.find(
    (candidate) =>
      candidate.props.accessibilityLabel === label &&
      typeof candidate.props.onPress === "function",
  );
  act(() => node.props.onPress());
}

/** Whether the menu draws a pressable row with this label. */
function hasRow(tree: ReactTestRenderer, label: string): boolean {
  return (
    tree.root.findAll(
      (candidate) =>
        candidate.props.accessibilityLabel === label &&
        typeof candidate.props.onPress === "function",
    ).length > 0
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.mocked(Alert.alert).mockClear();
  vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  report.mutateAsync.mockReset();
  blockActions.block.mockReset();
});

/** What `useReportMessage` resolves. */
function filed(alreadyReported = false) {
  return { report: { id: "r1" }, alreadyReported };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A local wall-clock time, so "Today" holds wherever the suite runs. */
const SENT_AT = (() => {
  const at = new Date();
  at.setHours(17, 16, 0, 0);
  return at.toISOString();
})();

describe("MessageActionsSheet — reply, edit and delete (#2775)", () => {
  const OWN = {
    messageId: "m9",
    copyText: null,
    canReply: true,
    canEdit: true,
    canDelete: true,
    canReport: false,
    blockUserId: null,
    senderName: "Vic",
    senderInDirectory: true,
    senderLabel: "Blake",
    sentAt: SENT_AT,
    reactedWith: [],
  };

  it("says who sent the message and when, since a follow-on row shows neither", () => {
    // components.md §11: a phone has no hover, so a grouped row draws no time
    // and this header line is where a member finds it.
    const tree = render({ ...OWN, senderLabel: "You" });
    const time = new Date(SENT_AT).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(text(tree)).toContain(`You · Today at ${time}`);
  });

  it("opens on that line, with no Message title over the menu", () => {
    // components.md § Chrome weight: an action menu draws no title and no
    // Cancel. The grabber, the scrim, Android back and VoiceOver's escape
    // close it (`SheetBackToClose`, `useSheetClose`).
    const tree = render(OWN);
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" &&
          node.props.children === "Message",
      ),
    ).toHaveLength(0);
  });

  it("draws no chevron on any menu row, as Discord's menu draws none", () => {
    const chevrons = (tree: ReactTestRenderer) =>
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" && node.props.children === "›",
      ).length;
    // Reply, Edit and Delete all act here.
    expect(chevrons(render(OWN))).toBe(0);
    // Report opens the form, but a menu row is a verb, not a link.
    const blockable = render({
      ...SOMEONE_ELSES,
      messageId: "m1",
      copyText: null,
      blockUserId: BLOCKED,
      senderName: "Blake",
      senderInDirectory: true,
      senderLabel: "Blake",
      sentAt: SENT_AT,
      reactedWith: [],
    });
    expect(chevrons(blockable)).toBe(0);
  });

  it("offers Copy text after Reply, copies the body as written, then says Copied in place", async () => {
    vi.useFakeTimers();
    try {
      const tree = render({ ...OWN, copyText: "see you at **8**" });
      const labels = tree.root
        .findAll(
          (node) =>
            typeof node.props.accessibilityLabel === "string" &&
            typeof node.props.onPress === "function",
        )
        .map((node) => node.props.accessibilityLabel as string);
      expect(labels.indexOf("Reply")).toBeLessThan(labels.indexOf("Copy text"));

      pressByLabel(tree, "Copy text");
      await flush();
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith("see you at **8**");
      expect(hasRow(tree, COPIED_LABEL)).toBe(true);
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        COPIED_LABEL,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws no Copy text when the message has nothing to copy", () => {
    // `copyableText` (`@repo/chat-core`, its own spec) returns null for a
    // card, a photo-only and a deleted message; the sheet hides the row then.
    expect(hasRow(render(OWN), "Copy text")).toBe(false);
  });

  it("starts the next open on Copy text again, however the sheet closed", async () => {
    const tree = render({ ...OWN, copyText: "hi" });
    pressByLabel(tree, "Copy text");
    await flush();
    expect(hasRow(tree, COPIED_LABEL)).toBe(true);
    const modal = tree.root.find(
      (node) =>
        typeof node.props.onDismiss === "function" &&
        node.props.enableDynamicSizing === true,
    );
    act(() => modal.props.onDismiss());
    expect(hasRow(tree, "Copy text")).toBe(true);
  });

  it("offers Reply, Edit and Delete on your own message, and never Report or Block", () => {
    const tree = render(OWN);
    expect(hasRow(tree, "Reply")).toBe(true);
    expect(hasRow(tree, "Edit message")).toBe(true);
    expect(hasRow(tree, "Delete message")).toBe(true);
    expect(hasRow(tree, "Report message")).toBe(false);
    expect(text(tree)).not.toContain("Block");
  });

  it("offers only the rows the target allows", () => {
    const tree = render({
      ...SOMEONE_ELSES,
      canReply: true,
      canDelete: true,
      messageId: "m1",
      copyText: null,
      blockUserId: BLOCKED,
      senderName: "Blake",
      senderInDirectory: true,
      senderLabel: "Blake",
      sentAt: SENT_AT,
      reactedWith: [],
    });
    expect(hasRow(tree, "Reply")).toBe(true);
    expect(hasRow(tree, "Edit message")).toBe(false);
    expect(hasRow(tree, "Delete message")).toBe(true);
    expect(hasRow(tree, "Report message")).toBe(true);
  });

  it("hands each row's message to the thread", () => {
    const onReply = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const tree = render(OWN, undefined, { onReply, onEdit, onDelete });
    pressByLabel(tree, "Reply");
    pressByLabel(tree, "Edit message");
    pressByLabel(tree, "Delete message");
    expect(onReply).toHaveBeenCalledWith("m9");
    expect(onEdit).toHaveBeenCalledWith("m9");
    expect(onDelete).toHaveBeenCalledWith("m9");
  });

  it("offers Start thread under Reply where the target allows it, and hands it off (#3785)", () => {
    const onReply = vi.fn();
    const onStartThread = vi.fn();
    const tree = render({ ...OWN, canStartThread: true }, undefined, {
      onReply,
      onStartThread,
    });
    const labels = tree.root
      .findAll(
        (node) =>
          typeof node.props.accessibilityLabel === "string" &&
          typeof node.props.onPress === "function",
      )
      .map((node) => node.props.accessibilityLabel as string);
    expect(labels.indexOf("Reply")).toBeLessThan(
      labels.indexOf("Start thread"),
    );
    expect(labels.indexOf("Start thread")).toBeLessThan(
      labels.indexOf("Edit message"),
    );
    pressByLabel(tree, "Start thread");
    expect(onStartThread).toHaveBeenCalledWith("m9");
  });

  it("draws no Start thread without the target's say-so or a handler", () => {
    expect(
      hasRow(
        render(OWN, undefined, { onStartThread: vi.fn() }),
        "Start thread",
      ),
    ).toBe(false);
    expect(
      hasRow(render({ ...OWN, canStartThread: true }), "Start thread"),
    ).toBe(false);
  });

  it("closes the menu before handing off, so it never covers the strip or the alert", () => {
    const dismiss = vi.fn();
    const onReply = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MessageActionsSheet
            ref={createRef<MessageActionsSheetHandle>()}
            target={OWN}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </FrappThemeProvider>,
        {
          // The stand-in modal is a host string; hand the refs an instance
          // that records the dismiss.
          createNodeMock: (element) =>
            element.type === "BottomSheetModal" ? { dismiss } : null,
        },
      );
    });
    for (const label of ["Reply", "Edit message", "Delete message"]) {
      dismiss.mockClear();
      pressByLabel(tree, label);
      expect(dismiss).toHaveBeenCalled();
    }
  });
});

describe("MessageActionsSheet — quick reactions", () => {
  // The thread draws no reaction control on a message nobody has reacted to,
  // so this row is where the first reaction starts.
  const TARGET: MessageActionsTarget = {
    ...SOMEONE_ELSES,
    messageId: "m4",
    copyText: null,
    blockUserId: null,
    senderName: "Blake",
    senderInDirectory: true,
    senderLabel: "Blake",
    sentAt: SENT_AT,
    reactedWith: ["🔥"],
  };

  function renderWith(
    target: MessageActionsTarget,
    handlers: {
      onReact?: (messageId: string, emoji: string) => void;
      onUnreact?: (messageId: string, emoji: string) => void;
    },
    dismiss = vi.fn(),
  ) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MessageActionsSheet
            ref={createRef<MessageActionsSheetHandle>()}
            target={target}
            {...handlers}
          />
        </FrappThemeProvider>,
        {
          createNodeMock: (element) =>
            element.type === "BottomSheetModal" ? { dismiss } : null,
        },
      );
    });
    return tree;
  }

  it("draws web's four picks ahead of the rows", () => {
    const tree = renderWith(TARGET, { onReact: vi.fn(), onUnreact: vi.fn() });
    const labels = tree.root
      .findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          typeof node.props.accessibilityLabel === "string",
      )
      .map((node) => node.props.accessibilityLabel as string);
    expect(QUICK_REACTIONS).toEqual(["👍", "🙏", "✅", "🔥"]);
    const picks = QUICK_REACTIONS.map((emoji) =>
      quickReactionLabel(emoji, emoji === "🔥"),
    );
    for (const pick of picks) expect(labels).toContain(pick);
    expect(labels.indexOf(picks[3]!)).toBeLessThan(
      labels.indexOf("Report message"),
    );
  });

  it("adds a reaction, and closes the sheet", () => {
    const onReact = vi.fn();
    const onUnreact = vi.fn();
    const dismiss = vi.fn();
    const tree = renderWith(TARGET, { onReact, onUnreact }, dismiss);
    pressByLabel(tree, quickReactionLabel("👍", false));
    expect(onReact).toHaveBeenCalledWith("m4", "👍");
    expect(onUnreact).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalled();
  });

  it("draws one the viewer already used as selected, and takes it back on a tap", () => {
    const onReact = vi.fn();
    const onUnreact = vi.fn();
    const tree = renderWith(TARGET, { onReact, onUnreact });
    const mine = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === quickReactionLabel("🔥", true),
    );
    expect(mine.props.accessibilityState).toEqual({ selected: true });
    const style = JSON.stringify(mine.props.style({ pressed: false }));
    // The chapter's quiet fill and border, as on the reacted chip.
    expect(style).toContain("#251A33");
    expect(style).toContain("#5C3E8A");
    pressByLabel(tree, quickReactionLabel("🔥", true));
    expect(onUnreact).toHaveBeenCalledWith("m4", "🔥");
    expect(onReact).not.toHaveBeenCalled();
  });

  it("opens every emoji from the last cell, and reacts with the one picked", () => {
    const onReact = vi.fn();
    const onUnreact = vi.fn();
    const present = vi.fn();
    const dismiss = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MessageActionsSheet
            ref={createRef<MessageActionsSheetHandle>()}
            target={TARGET}
            onReact={onReact}
            onUnreact={onUnreact}
          />
        </FrappThemeProvider>,
        {
          createNodeMock: (element) =>
            element.type === "BottomSheetModal" ? { present, dismiss } : null,
        },
      );
    });
    pressByLabel(tree, "Add a reaction");
    expect(present).toHaveBeenCalled();
    const picker = tree.root.find(
      (node) =>
        typeof node.props.onPick === "function" &&
        Array.isArray(node.props.selected),
    );
    expect(picker.props.selected).toEqual(["🔥"]);
    act(() => picker.props.onPick("🎉", false));
    expect(onReact).toHaveBeenCalledWith("m4", "🎉");
    act(() => picker.props.onPick("🔥", true));
    expect(onUnreact).toHaveBeenCalledWith("m4", "🔥");
  });

  it("closes the keyboard before it opens, so the menu isn't drawn under it (#4142)", () => {
    const order: string[] = [];
    const dismissKeyboard = vi
      .spyOn(Keyboard, "dismiss")
      .mockImplementation(() => order.push("keyboard"));
    const handle = createRef<MessageActionsSheetHandle>();
    act(() => {
      create(
        <FrappThemeProvider>
          <MessageActionsSheet ref={handle} target={TARGET} />
        </FrappThemeProvider>,
        {
          createNodeMock: (element) =>
            element.type === "BottomSheetModal"
              ? { present: () => order.push("menu"), dismiss: vi.fn() }
              : null,
        },
      );
    });
    act(() => handle.current?.present());
    expect(order).toEqual(["keyboard", "menu"]);
    dismissKeyboard.mockRestore();
  });

  it("draws no picks when the thread wires no reaction handlers", () => {
    const tree = renderWith(TARGET, {});
    expect(text(tree)).not.toContain("🙏");
  });
});

describe("MessageActionsSheet — dismissed for a deleted message (#3795)", () => {
  const TARGET: MessageActionsTarget = {
    ...SOMEONE_ELSES,
    messageId: "m5",
    copyText: null,
    blockUserId: null,
    senderName: "Blake",
    senderInDirectory: true,
    senderLabel: "Blake",
    sentAt: SENT_AT,
    reactedWith: [],
  };

  type ModalProps = Record<string, unknown>;
  const isMenu = (props: ModalProps) => props.enableDynamicSizing === true;
  // The report form is the other `replace` sheet; the picker is the tall one.
  const isPicker = (props: ModalProps) =>
    props.stackBehavior === "replace" &&
    JSON.stringify(props.snapPoints) === JSON.stringify(["100%"]);
  const isReport = (props: ModalProps) =>
    props.stackBehavior === "replace" &&
    JSON.stringify(props.snapPoints) === JSON.stringify(["85%"]);

  /**
   * gorhom 5.2's modal as far as this bug goes: `dismiss()` on a modal that
   * isn't presented leaves it stuck mid-dismiss, and every later `present()`
   * draws nothing (`BottomSheetModal` handleDismiss / handlePortalRender).
   */
  function fakeModal() {
    const modal = {
      shown: false,
      wedged: false,
      present: vi.fn(() => {
        if (!modal.wedged) modal.shown = true;
      }),
      dismiss: vi.fn(() => {
        if (!modal.shown) modal.wedged = true;
        modal.shown = false;
      }),
    };
    return modal;
  }

  function mount(target: MessageActionsTarget = TARGET) {
    const menu = fakeModal();
    const picker = fakeModal();
    const report = fakeModal();
    const handle = createRef<MessageActionsSheetHandle>();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MessageActionsSheet
            ref={handle}
            target={target}
            onReact={vi.fn()}
            onUnreact={vi.fn()}
          />
        </FrappThemeProvider>,
        {
          createNodeMock: (element) => {
            if (element.type !== "BottomSheetModal") return null;
            const props = element.props as ModalProps;
            if (isMenu(props)) return menu;
            if (isPicker(props)) return picker;
            if (isReport(props)) return report;
            return fakeModal();
          },
        },
      );
    });
    const modal = (which: (props: ModalProps) => boolean) =>
      tree.root.find(
        (node) =>
          (node.type as unknown) === "BottomSheetModal" && which(node.props),
      );
    /** What gorhom fires as a modal slides up, and once it has closed. */
    const opened = (which: (props: ModalProps) => boolean) =>
      act(() => modal(which).props.onAnimate?.(-1, 0));
    const closed = (which: (props: ModalProps) => boolean) =>
      act(() => modal(which).props.onDismiss?.());
    return { menu, picker, report, handle, tree, opened, closed };
  }

  it("leaves both modals alone when the message is deleted after the menu closed", () => {
    const { menu, picker, handle, opened, closed } = mount();
    act(() => handle.current?.present());
    opened(isMenu);
    closed(isMenu);

    act(() => handle.current?.dismiss());
    expect(menu.dismiss).not.toHaveBeenCalled();
    expect(picker.dismiss).not.toHaveBeenCalled();

    // The next long-press still opens the menu.
    act(() => handle.current?.present());
    expect(menu.wedged).toBe(false);
    expect(menu.shown).toBe(true);
  });

  it("closes an open menu, and leaves the never-opened picker alone", () => {
    const { menu, picker, handle, tree, opened } = mount();
    act(() => handle.current?.present());
    opened(isMenu);

    act(() => handle.current?.dismiss());
    expect(menu.dismiss).toHaveBeenCalledTimes(1);
    expect(picker.dismiss).not.toHaveBeenCalled();

    // "Every emoji" still opens on the next message.
    pressByLabel(tree, "Add a reaction");
    expect(picker.wedged).toBe(false);
    expect(picker.shown).toBe(true);
  });

  it("closes the picker when it is the one up", () => {
    const { menu, picker, handle, tree, opened, closed } = mount();
    act(() => handle.current?.present());
    opened(isMenu);
    pressByLabel(tree, "Add a reaction");
    opened(isPicker);
    // `stackBehavior="replace"` dismissed the menu under it.
    closed(isMenu);

    act(() => handle.current?.dismiss());
    expect(picker.dismiss).toHaveBeenCalledTimes(1);
    expect(menu.dismiss).not.toHaveBeenCalled();
    expect(picker.wedged).toBe(false);
  });
  it("leaves the picker alone when it was opened and closed before the delete", () => {
    const { menu, picker, handle, tree, opened, closed } = mount();
    act(() => handle.current?.present());
    opened(isMenu);
    pressByLabel(tree, "Add a reaction");
    opened(isPicker);
    closed(isMenu);
    closed(isPicker);

    act(() => handle.current?.dismiss());
    expect(picker.dismiss).not.toHaveBeenCalled();
    expect(menu.dismiss).not.toHaveBeenCalled();

    pressByLabel(tree, "Add a reaction");
    expect(picker.wedged).toBe(false);
    expect(picker.shown).toBe(true);
  });

  it("closes the menu once it starts to open when the delete lands first", () => {
    const { menu, handle, opened } = mount();
    // Deleted between the long-press and gorhom's first frame: not up yet,
    // so dismissing now would wedge it, and dropping it would open the menu
    // on a deleted message.
    act(() => handle.current?.present());
    act(() => handle.current?.dismiss());
    expect(menu.dismiss).not.toHaveBeenCalled();

    opened(isMenu);
    expect(menu.dismiss).toHaveBeenCalledTimes(1);
    expect(menu.wedged).toBe(false);
  });

  it("arms no Copied close for a copy that settles after the menu closed", async () => {
    vi.useFakeTimers();
    try {
      const write = deferred<boolean>();
      vi.mocked(Clipboard.setStringAsync).mockReturnValueOnce(write.promise);
      const { menu, handle, tree, opened, closed } = mount({
        ...TARGET,
        copyText: "hi",
      });
      act(() => handle.current?.present());
      opened(isMenu);
      pressByLabel(tree, "Copy text");
      closed(isMenu);

      write.resolve(true);
      await flush();
      act(() => vi.runAllTimers());
      expect(menu.dismiss).not.toHaveBeenCalled();
      expect(menu.wedged).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a closed report form alone when a block settles late", async () => {
    const request = deferred<undefined>();
    blockActions.block.mockReturnValueOnce(request.promise);
    const { report, tree, opened, closed } = mount({
      ...TARGET,
      blockUserId: BLOCKED,
    });
    opened(isReport);
    pressByLabel(tree, "Block Blake");
    const [, , buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    act(() => buttons!.find((b) => b.style === "destructive")!.onPress!());
    // The member swipes the form away while the block is in flight.
    closed(isReport);

    request.resolve(undefined);
    await flush();
    await flush();
    expect(blockActions.block).toHaveBeenCalledWith(BLOCKED);
    expect(report.dismiss).not.toHaveBeenCalled();
    expect(report.wedged).toBe(false);
  });
});

describe("MessageActionsSheet — menu", () => {
  it("offers Report and Block for a blockable sender", () => {
    const tree = render({
      ...SOMEONE_ELSES,
      messageId: "m1",
      copyText: null,
      blockUserId: BLOCKED,
      senderName: "Blake",
      senderInDirectory: true,
      senderLabel: "Blake",
      sentAt: SENT_AT,
      reactedWith: [],
    });
    expect(text(tree)).toContain("Report message");
    expect(text(tree)).toContain("Block Blake");
  });

  it("offers Report only when the sender cannot be blocked (system actor, imported row)", () => {
    const tree = render({
      ...SOMEONE_ELSES,
      messageId: "m1",
      copyText: null,
      blockUserId: null,
      senderName: "Frapp",
      senderInDirectory: false,
      senderLabel: "Blake",
      sentAt: SENT_AT,
      reactedWith: [],
    });
    expect(text(tree)).toContain("Report message");
    expect(text(tree)).not.toContain("Block Frapp");
  });

  it("confirms before blocking, and blocks only on the destructive choice", async () => {
    blockActions.block.mockResolvedValue(undefined);
    const tree = render({
      ...SOMEONE_ELSES,
      messageId: "m1",
      copyText: null,
      blockUserId: BLOCKED,
      senderName: "Blake",
      senderInDirectory: true,
      senderLabel: "Blake",
      sentAt: SENT_AT,
      reactedWith: [],
    });

    pressByLabel(tree, "Block Blake");
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    expect(title).toBe("Block Blake?");
    expect(body).toBe(blockConfirmBody(true, "in Settings"));
    expect(body).toMatch(/won't be told/);
    expect(blockActions.block).not.toHaveBeenCalled();

    const confirm = buttons!.find((button) => button.style === "destructive");
    act(() => confirm!.onPress!());
    await flush();
    expect(blockActions.block).toHaveBeenCalledWith(BLOCKED);
  });

  it("keeps Block off the menu: it is one step in, on the report form", () => {
    const tree = render({
      ...SOMEONE_ELSES,
      messageId: "m1",
      copyText: null,
      blockUserId: BLOCKED,
      senderName: "Blake",
      senderInDirectory: true,
      senderLabel: "Blake",
      sentAt: SENT_AT,
      reactedWith: [],
    });
    const menu = tree.root.find(
      (node) =>
        typeof node.props.onDismiss === "function" &&
        node.props.enableDynamicSizing === true,
    );
    const report = tree.root.find(
      (node) => node.props.snapPoints?.[0] === "85%",
    );
    const labels = (node: typeof menu) =>
      node
        .findAll((n) => typeof n.props.accessibilityLabel === "string")
        .map((n) => n.props.accessibilityLabel as string);
    expect(labels(menu)).not.toContain("Block Blake");
    expect(labels(report)).toContain("Block Blake");
  });

  it("draws bare labels, with no sentence explaining a row", () => {
    const tree = render({
      ...SOMEONE_ELSES,
      canReply: true,
      canDelete: true,
      canMention: true,
      messageId: "m1",
      copyText: "hi",
      blockUserId: BLOCKED,
      senderName: "Blake",
      senderInDirectory: true,
      senderLabel: "Blake",
      sentAt: SENT_AT,
      reactedWith: [],
    });
    expect(text(tree)).not.toContain("officers will be able to see it");
    expect(text(tree)).not.toContain("Hides their messages");
  });

  it("orders the rows the way Discord does: Reply, Copy text, Mention, Report, Delete", () => {
    const tree = render(
      {
        ...SOMEONE_ELSES,
        canReply: true,
        canDelete: true,
        canMention: true,
        messageId: "m1",
        copyText: "hi",
        blockUserId: BLOCKED,
        senderName: "Blake",
        senderInDirectory: true,
        senderLabel: "Blake",
        sentAt: SENT_AT,
        reactedWith: [],
      },
      undefined,
      { onMention: vi.fn() },
    );
    const menu = tree.root.find(
      (node) =>
        typeof node.props.onDismiss === "function" &&
        node.props.enableDynamicSizing === true,
    );
    const order = menu
      .findAll(
        (n) =>
          typeof n.props.accessibilityLabel === "string" &&
          typeof n.props.onPress === "function",
      )
      .map((n) => n.props.accessibilityLabel as string)
      .filter((label, i, all) => all.indexOf(label) === i);
    expect(order).toEqual([
      "Reply",
      "Copy text",
      "Mention",
      "Report message",
      "Delete message",
    ]);
  });

  it("hands Mention's message to the thread, and offers it only when allowed", () => {
    const onMention = vi.fn();
    const base = {
      ...SOMEONE_ELSES,
      messageId: "m1",
      copyText: null,
      blockUserId: BLOCKED,
      senderName: "Blake",
      senderInDirectory: true,
      senderLabel: "Blake",
      sentAt: SENT_AT,
      reactedWith: [],
    };
    expect(hasRow(render(base, undefined, { onMention }), "Mention")).toBe(
      false,
    );
    const tree = render({ ...base, canMention: true }, undefined, {
      onMention,
    });
    pressByLabel(tree, "Mention");
    expect(onMention).toHaveBeenCalledWith("m1");
  });

  it("tells the caller when the API says the sender left, so Block stops being offered for them", async () => {
    blockActions.block.mockRejectedValue({
      statusCode: 404,
      message: "Member not found",
    });
    const onSenderDeparted = vi.fn();
    const tree = render(
      {
        ...SOMEONE_ELSES,
        messageId: "m1",
        copyText: null,
        blockUserId: BLOCKED,
        senderName: null,
        senderInDirectory: false,
        senderLabel: "Blake",
        sentAt: SENT_AT,
        reactedWith: [],
      },
      onSenderDeparted,
    );

    pressByLabel(tree, "Block this member");
    const [, , buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    act(() => buttons!.find((b) => b.style === "destructive")!.onPress!());
    await flush();
    await flush();

    expect(Alert.alert).toHaveBeenLastCalledWith(
      "Couldn't block this member",
      BLOCK_NOT_A_MEMBER_BODY,
    );
    expect(onSenderDeparted).toHaveBeenCalledWith(BLOCKED);
  });
});

describe("MessageActionsSheet — report", () => {
  const target: MessageActionsTarget = {
    ...SOMEONE_ELSES,
    messageId: "m1",
    copyText: null,
    blockUserId: BLOCKED,
    senderName: "Blake",
    senderInDirectory: true,
    senderLabel: "Blake",
    sentAt: SENT_AT,
    reactedWith: [],
  };

  function sendButton(tree: ReactTestRenderer) {
    return tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.findAll(
          (child) =>
            (child.type as unknown) === "Text" &&
            child.props.children === "Send report",
        ).length > 0,
    );
  }

  it("cannot send until a reason is picked", () => {
    const tree = render(target);
    expect(sendButton(tree).props.disabled).toBe(true);
  });

  it("files the chosen reason and details against the message", async () => {
    report.mutateAsync.mockResolvedValue(filed());
    const tree = render(target);

    pressByLabel(tree, "Harassment or bullying");
    const input = tree.root.find(
      (node) => node.props.accessibilityLabel === "Details, optional",
    );
    act(() => input.props.onChangeText("keeps DMing me"));
    act(() => sendButton(tree).props.onPress());
    await flush();

    expect(report.mutateAsync).toHaveBeenCalledWith({
      messageId: "m1",
      reason: "harassment",
      details: "keeps DMing me",
    });
    expect(text(tree)).toContain(REPORT_SENT_BODY);
    // Promises neither a reviewer nor a response time.
    expect(REPORT_SENT_BODY).not.toMatch(/within|hours|days|respond/i);
    // VoiceOver hears it too: `accessibilityLiveRegion` is Android-only.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      REPORT_SENT_TITLE,
    );
  });

  it("titles the sent sheet with no header Done beside its primary Done", async () => {
    // components.md § Chrome weight: never a header Done and a primary Done.
    report.mutateAsync.mockResolvedValue(filed());
    const tree = render(target);
    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    await flush();

    const headers = tree.root.findAllByType(SheetHeader);
    const sent = headers.find((h) => h.props.title === REPORT_SENT_TITLE);
    expect(sent).toBeDefined();
    expect(sent!.props.onCancel).toBeUndefined();
  });

  it("says it was already reported, rather than 'Report sent', when the API hands back the open report", async () => {
    report.mutateAsync.mockResolvedValue(filed(true));
    const tree = render(target);

    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    await flush();

    expect(text(tree)).toContain(REPORT_ALREADY_BODY);
    expect(text(tree)).not.toContain(REPORT_SENT_BODY);
    expect(text(tree)).not.toContain(REPORT_SENT_TITLE);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      REPORT_ALREADY_BODY,
    );
  });

  it("still reports a failure that comes back after the sheet was dismissed (finding 9)", async () => {
    const request = deferred<ReturnType<typeof filed>>();
    report.mutateAsync.mockReturnValue(request.promise);
    const tree = render(target);

    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    const reportSheet = tree.root.find(
      (node) =>
        (node.type as unknown) === "BottomSheetModal" &&
        node.props.stackBehavior === "replace" &&
        typeof node.props.onDismiss === "function",
    );
    act(() => reportSheet.props.onDismiss());

    await act(async () => {
      request.reject(new Error("offline"));
      await Promise.resolve();
    });
    await flush();

    expect(Alert.alert).toHaveBeenCalledWith(
      REPORT_FAILED_TITLE,
      REPORT_FAILED_BODY,
    );
  });

  it("does not alert over a success that comes back after dismissal", async () => {
    const request = deferred<ReturnType<typeof filed>>();
    report.mutateAsync.mockReturnValue(request.promise);
    const tree = render(target);

    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    const reportSheet = tree.root.find(
      (node) =>
        (node.type as unknown) === "BottomSheetModal" &&
        node.props.stackBehavior === "replace" &&
        typeof node.props.onDismiss === "function",
    );
    act(() => reportSheet.props.onDismiss());

    await act(async () => {
      request.resolve(filed());
      await Promise.resolve();
    });
    await flush();

    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("says so when the report did not send, and keeps the form", async () => {
    report.mutateAsync.mockRejectedValue(new Error("offline"));
    const tree = render(target);

    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    await flush();

    expect(text(tree)).toContain(REPORT_FAILED_BODY);
    expect(text(tree)).not.toContain(REPORT_SENT_BODY);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      REPORT_FAILED_BODY,
    );
    // On screen, so no alert on top of it.
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("says a refused report cannot be sent at all, rather than asking to retry (finding 8)", async () => {
    for (const statusCode of [403, 404, 409]) {
      vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
      report.mutateAsync.mockRejectedValue({ statusCode, message: "nope" });
      const tree = render(target);

      pressByLabel(tree, "Spam");
      act(() => sendButton(tree).props.onPress());
      await flush();

      expect(text(tree)).toContain(REPORT_UNAVAILABLE_BODY);
      expect(text(tree)).not.toContain(REPORT_FAILED_BODY);
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        REPORT_UNAVAILABLE_BODY,
      );
    }
  });

  it("asks for another try on a server error", async () => {
    report.mutateAsync.mockRejectedValue({ statusCode: 503 });
    const tree = render(target);

    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    await flush();

    expect(text(tree)).toContain(REPORT_FAILED_BODY);
  });

  it("alerts the permanent refusal too when the form was already dismissed", async () => {
    const request = deferred<ReturnType<typeof filed>>();
    report.mutateAsync.mockReturnValue(request.promise);
    const tree = render(target);

    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    const reportSheet = tree.root.find(
      (node) =>
        (node.type as unknown) === "BottomSheetModal" &&
        node.props.stackBehavior === "replace" &&
        typeof node.props.onDismiss === "function",
    );
    act(() => reportSheet.props.onDismiss());

    await act(async () => {
      request.reject({ statusCode: 403, message: "Forbidden" });
      await Promise.resolve();
    });
    await flush();

    expect(Alert.alert).toHaveBeenCalledWith(
      REPORT_FAILED_TITLE,
      REPORT_UNAVAILABLE_BODY,
    );
  });

  it("starts a fresh form for the next message", async () => {
    report.mutateAsync.mockResolvedValue(filed());
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MessageActionsSheet target={target} />
        </FrappThemeProvider>,
      );
    });
    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    await flush();
    expect(text(tree)).toContain(REPORT_SENT_BODY);

    act(() => {
      tree.update(
        <FrappThemeProvider>
          <MessageActionsSheet target={{ ...target, messageId: "m2" }} />
        </FrappThemeProvider>,
      );
    });
    expect(text(tree)).not.toContain(REPORT_SENT_BODY);
    expect(sendButton(tree).props.disabled).toBe(true);
  });
});

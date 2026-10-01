/** @vitest-environment jsdom */
import React, { act, useRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { AccessibilityInfo, BackHandler, Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBackToClose, useFocusOnOpen } from "./overlay";

/**
 * The overlay effects (`spec/ui/mobile/patterns.md` § Overlays). The mute
 * menu's and the image viewer's own specs prove each one uses them; this pins
 * what they do.
 */

function BackHarness({ open, close }: { open: boolean; close: () => void }) {
  useBackToClose(open, close);
  return null;
}

function FocusHarness({ open }: { open: boolean }) {
  const ref = useRef<React.ComponentRef<typeof Text>>(null);
  useFocusOnOpen(ref, open);
  return <Text ref={ref}>Overlay title</Text>;
}

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element, {
      // Host refs resolve to a stand-in that remembers its element, so a spec
      // can tell which node focus was sent to.
      createNodeMock: (node) => ({ element: node }),
    });
  });
  return tree;
}

const addListener = () => vi.mocked(BackHandler.addEventListener);

/** The handler and subscription of the newest back listener. */
function latestListener() {
  const [, handler] = addListener().mock.calls.at(-1)!;
  const subscription = addListener().mock.results.at(-1)!.value as {
    remove: ReturnType<typeof vi.fn>;
  };
  return { handler: handler as () => boolean, subscription };
}

const focusEvents = () =>
  vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls as unknown as [
    { element: { props: { children?: unknown } } },
    string,
  ][];

beforeEach(() => {
  // `clearMocks` is off suite-wide (vitest.config.ts), and both natives are
  // shared stand-ins.
  addListener().mockClear();
  vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

describe("useBackToClose", () => {
  it("holds nothing while the overlay is closed", () => {
    render(<BackHarness open={false} close={vi.fn()} />);
    expect(addListener()).not.toHaveBeenCalled();
  });

  it("closes the open overlay on Android's back button, and stops the press there", () => {
    const close = vi.fn();
    render(<BackHarness open close={close} />);
    expect(addListener()).toHaveBeenCalledWith(
      "hardwareBackPress",
      expect.any(Function),
    );

    const { handler } = latestListener();
    let handled: boolean | null | undefined;
    act(() => {
      handled = handler();
    });

    expect(close).toHaveBeenCalledTimes(1);
    // `true` is what keeps the navigator underneath from popping.
    expect(handled).toBe(true);
  });

  it("lets go once the overlay closes, and when it unmounts open", () => {
    const close = vi.fn();
    const tree = render(<BackHarness open close={close} />);
    const first = latestListener().subscription;

    act(() => tree.update(<BackHarness open={false} close={close} />));
    expect(first.remove).toHaveBeenCalledTimes(1);

    act(() => tree.update(<BackHarness open close={close} />));
    const second = latestListener().subscription;
    act(() => tree.unmount());
    expect(second.remove).toHaveBeenCalledTimes(1);
  });

  it("calls the close it was last given", () => {
    const stale = vi.fn();
    const current = vi.fn();
    const tree = render(<BackHarness open close={stale} />);
    act(() => tree.update(<BackHarness open close={current} />));

    act(() => {
      latestListener().handler();
    });

    expect(current).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });
});

describe("useFocusOnOpen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves a screen reader's focus onto the overlay, from the task after it mounts", () => {
    render(<FocusHarness open />);
    // Not from the opening commit's effect: on Android that runs before the
    // view exists, and the event would be dropped.
    expect(focusEvents()).toHaveLength(0);

    act(() => {
      vi.runAllTimers();
    });

    expect(focusEvents()).toHaveLength(1);
    const [[target, eventType]] = focusEvents();
    expect(eventType).toBe("focus");
    expect(target.element.props.children).toBe("Overlay title");
  });

  it("sends nothing while the overlay is closed", () => {
    render(<FocusHarness open={false} />);
    act(() => {
      vi.runAllTimers();
    });
    expect(focusEvents()).toHaveLength(0);
  });

  it("drops the pending focus when the overlay closes before it is sent", () => {
    const tree = render(<FocusHarness open />);
    act(() => tree.update(<FocusHarness open={false} />));

    act(() => {
      vi.runAllTimers();
    });

    expect(focusEvents()).toHaveLength(0);
  });

  it("moves focus again each time the overlay opens", () => {
    const tree = render(<FocusHarness open />);
    act(() => {
      vi.runAllTimers();
    });
    act(() => tree.update(<FocusHarness open={false} />));
    act(() => tree.update(<FocusHarness open />));
    act(() => {
      vi.runAllTimers();
    });

    expect(focusEvents()).toHaveLength(2);
  });
});

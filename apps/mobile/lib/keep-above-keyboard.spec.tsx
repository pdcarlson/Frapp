/** @vitest-environment jsdom */
import React, { useRef } from "react";
import { act } from "react";
import { Keyboard, type ScrollView, View } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  revealScrollY,
  ScrollRevealProvider,
  useKeepAboveKeyboard,
  useScrollReveal,
} from "@/lib/keep-above-keyboard";

/**
 * #5463: on Event details the keyboard covered the agenda field and each item
 * just added under it. The screen now rises with the keyboard and scrolls the
 * focused field into the band between the pinned back row and the keyboard,
 * again each time an item pushes it down.
 *
 * The layout below is an iPhone 15's (852pt tall, 59pt top inset, 34pt home
 * indicator, a 336pt keyboard with its suggestion bar), measured in the window
 * the way the device reports it, with an agenda of 3 to 15 items. A headless
 * run can't draw the keyboard, so these pin the arithmetic and the wiring,
 * not the pixels.
 */

const SCREEN = 852;
const TOP_INSET = 59;
const KEYBOARD = 336;
const KEYBOARD_TOP = SCREEN - KEYBOARD;
/** The pinned back row's clearance and the room kept above the keyboard. */
const BACK_ROW = 56;
const MARGIN = 12;
/** Where the agenda's first row sits in the scroll content, under the card. */
const AGENDA_TOP = 420;
const ROW = 44;
const GAP = 4;
const FIELD = 48;

/** Content under the field: attachments, the minutes row, the padding. */
const BELOW = 160;

/**
 * Scroll content the fakes below read: the field's place and the offset.
 * `risen` is whether the avoiding area has caught up with an open keyboard
 * (on Android its padding can still be growing at `keyboardDidShow`), and
 * `above` is how far sections above the agenda have grown since it loaded.
 */
const page = {
  offset: 0,
  items: 3,
  keyboardUp: false,
  risen: true,
  above: 0,
};

/** The field's top in the scroll content, under `items` rows. */
function fieldTop(items: number) {
  return AGENDA_TOP + page.above + items * (ROW + GAP);
}

/** The scroll view's frame: it ends at the keyboard once the area rises. */
function frameHeight() {
  return (
    (page.keyboardUp && page.risen ? KEYBOARD_TOP : SCREEN - 34) - TOP_INSET
  );
}

function contentHeight() {
  return fieldTop(page.items) + FIELD + BELOW;
}

type Measure = (
  cb: (x: number, y: number, w: number, h: number) => void,
) => void;

const frame = {
  measureInWindow: ((cb) => cb(0, TOP_INSET, 393, frameHeight())) as Measure,
};
const content = {
  measureInWindow: ((cb) =>
    cb(0, TOP_INSET - page.offset, 393, contentHeight())) as Measure,
};
const fieldView = {
  measureInWindow: ((cb) =>
    cb(
      16,
      TOP_INSET - page.offset + fieldTop(page.items),
      361,
      FIELD,
    )) as Measure,
};
// A scroll view stops at the end of its content, as Android's clamps each
// frame of an animated scroll to the range it has then.
const scrollTo = vi.fn(({ y }: { y: number }) => {
  page.offset = Math.min(y, Math.max(0, contentHeight() - frameHeight()));
});
const fakeScroll = {
  getNativeScrollRef: () => frame,
  getInnerViewRef: () => content,
  scrollTo,
} as unknown as ScrollView;

type Handlers = Omit<ReturnType<typeof useKeepAboveKeyboard>, "hold">;

/** The field's handlers, as the last render handed them out. */
const handed = new Map<"field" | "lone", Handlers>();

/** The agenda section: its hook stays mounted while the field comes and goes. */
function Field({ shown }: { shown: boolean }) {
  const { hold, ...keep } = useKeepAboveKeyboard();
  // The spec calls the handlers the field's own props would.
  handed.set("field", keep);
  return shown ? <View ref={hold} onLayout={keep.onLayout} /> : null;
}

function Screen({ shown = true }: { shown?: boolean }) {
  const scrollRef = useRef<ScrollView | null>(fakeScroll);
  const reveal = useScrollReveal(scrollRef, { top: BACK_ROW, margin: MARGIN });
  return (
    <ScrollRevealProvider value={reveal}>
      <Field shown={shown} />
    </ScrollRevealProvider>
  );
}

const didShow: (() => void)[] = [];
const mounted: ReactTestRenderer[] = [];

function render() {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Screen />, { createNodeMock: () => fieldView });
  });
  mounted.push(tree);
  return tree;
}

/** Lets the measurements' promise settle. */
async function settle() {
  await act(async () => {});
}

/** The field's bottom on screen, after whatever scroll ran. */
function fieldBottomOnScreen() {
  return TOP_INSET - page.offset + fieldTop(page.items) + FIELD;
}

function openKeyboard() {
  page.keyboardUp = true;
  for (const listener of didShow) listener();
}

beforeEach(() => {
  page.offset = 0;
  page.items = 3;
  page.keyboardUp = false;
  page.risen = true;
  page.above = 0;
  scrollTo.mockClear();
  didShow.length = 0;
  vi.mocked(Keyboard.addListener).mockImplementation(((
    event: string,
    listener: () => void,
  ) => {
    if (event === "keyboardDidShow") didShow.push(listener);
    return {
      remove: () => didShow.splice(didShow.indexOf(listener), 1),
    };
  }) as unknown as typeof Keyboard.addListener);
  vi.mocked(Keyboard.isVisible).mockImplementation(() => page.keyboardUp);
  (Keyboard as { metrics?: () => unknown }).metrics = () =>
    page.keyboardUp
      ? { screenX: 0, screenY: KEYBOARD_TOP, width: 393, height: KEYBOARD }
      : undefined;
});

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
  handed.clear();
});

describe("revealScrollY (#5463)", () => {
  const band = { visibleTop: 100, visibleBottom: 500, margin: 10 };

  it("leaves a target already in the band where it is", () => {
    expect(
      revealScrollY({ ...band, offset: 40, targetTop: 200, targetBottom: 248 }),
    ).toBeNull();
  });

  it("scrolls a target under the keyboard up just far enough", () => {
    expect(
      revealScrollY({ ...band, offset: 40, targetTop: 600, targetBottom: 648 }),
    ).toBe(40 + 648 + 10 - 500);
  });

  it("scrolls a target above the band down, never past the top", () => {
    expect(
      revealScrollY({ ...band, offset: 300, targetTop: 50, targetBottom: 98 }),
    ).toBe(300 + 50 - 10 - 100);
    expect(
      revealScrollY({ ...band, offset: 20, targetTop: 50, targetBottom: 98 }),
    ).toBe(0);
  });

  it("shows a target taller than the band from its top, where its field is", () => {
    expect(
      revealScrollY({ ...band, offset: 0, targetTop: 300, targetBottom: 900 }),
    ).toBe(300 - 10 - 100);
  });
});

describe("the agenda field on an iPhone-size Event details (#5463)", () => {
  it.each([3, 5, 8, 10, 12, 15])(
    "keeps the field, and the item just added, above the keyboard with %i items",
    async (items) => {
      page.items = items;
      render();
      act(() => handed.get("field")!.onFocus());
      await settle();
      // Focus alone, with the keyboard still opening, moves nothing.
      expect(scrollTo).not.toHaveBeenCalled();
      act(() => openKeyboard());
      await settle();
      const bottom = fieldBottomOnScreen();
      expect(bottom).toBeLessThanOrEqual(KEYBOARD_TOP - MARGIN);
      // The newest item sits just above the field, under the back row.
      const newestTop = bottom - FIELD - GAP - ROW;
      expect(newestTop).toBeGreaterThanOrEqual(TOP_INSET + BACK_ROW);

      // Return adds one: the field moves down a row and its layout reports it.
      page.items = items + 1;
      act(() => handed.get("field")!.onLayout());
      await settle();
      expect(fieldBottomOnScreen()).toBe(KEYBOARD_TOP - MARGIN);
    },
  );

  it("moves nothing while the keyboard is down", async () => {
    // Long enough that the field sits below the screen's own bottom edge, so
    // only the keyboard check keeps it still.
    page.items = 15;
    render();
    act(() => handed.get("field")!.onFocus());
    act(() => handed.get("field")!.onLayout());
    act(() => handed.get("field")!.onType());
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("reveals again once the avoiding area has risen", async () => {
    vi.useFakeTimers();
    page.items = 3;
    render();
    act(() => handed.get("field")!.onFocus());
    // Android: the event comes while the area's padding is still growing,
    // so the first scroll stops at the end of the old range.
    page.risen = false;
    act(() => openKeyboard());
    await settle();
    expect(fieldBottomOnScreen()).toBeGreaterThan(KEYBOARD_TOP - MARGIN);
    page.risen = true;
    act(() => vi.advanceTimersByTime(400));
    await settle();
    expect(fieldBottomOnScreen()).toBe(KEYBOARD_TOP - MARGIN);
  });

  it("brings the field back on the next keystroke after a section above grows", async () => {
    page.items = 8;
    render();
    act(() => handed.get("field")!.onFocus());
    act(() => openKeyboard());
    await settle();
    expect(fieldBottomOnScreen()).toBe(KEYBOARD_TOP - MARGIN);
    // The check-in card opens on the clock and grows; the field's own
    // layout in its section doesn't change.
    page.above = 60;
    expect(fieldBottomOnScreen()).toBeGreaterThan(KEYBOARD_TOP);
    act(() => handed.get("field")!.onType());
    await settle();
    expect(fieldBottomOnScreen()).toBe(KEYBOARD_TOP - MARGIN);
  });

  it("forgets the focus of a field that unmounted while focused", async () => {
    page.items = 12;
    const tree = render();
    act(() => handed.get("field")!.onFocus());
    // The agenda fills on Return: the field goes, sending no blur.
    act(() => tree.update(<Screen shown={false} />));
    // Another field opens the keyboard, and a Remove brings the field back.
    act(() => openKeyboard());
    act(() => tree.update(<Screen shown />));
    act(() => handed.get("field")!.onLayout());
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("lets the page be once the field loses focus", async () => {
    page.items = 12;
    render();
    act(() => handed.get("field")!.onFocus());
    act(() => handed.get("field")!.onBlur());
    act(() => openKeyboard());
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing outside a screen that provides a reveal", async () => {
    function Lone() {
      const { hold, ...keep } = useKeepAboveKeyboard();
      handed.set("lone", keep);
      return <View ref={hold} onLayout={keep.onLayout} />;
    }
    act(() => {
      mounted.push(create(<Lone />, { createNodeMock: () => fieldView }));
    });
    page.keyboardUp = true;
    act(() => handed.get("lone")!.onFocus());
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(didShow).toHaveLength(0);
  });
});

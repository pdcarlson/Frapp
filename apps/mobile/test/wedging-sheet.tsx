import { act, createRef, type ReactElement, type RefObject } from "react";
import { create } from "react-test-renderer";
import { expect, vi } from "vitest";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

/**
 * gorhom 5.2's modal as far as the wedge goes: `dismiss()` on a modal that
 * isn't presented leaves it stuck mid-dismiss, and every later `present()`
 * draws nothing (`BottomSheetModal` handleDismiss / handlePortalRender;
 * #3795, #4229, #5059).
 */
export function wedgingModal() {
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

/**
 * The host's side of a sheet guarded with `useGuardedSheetRef`: it dismisses
 * the sheet whether or not it is up (a blur, a channel switch), and that must
 * never reach a closed modal. `sheet(ref)` renders the sheet, theme and all,
 * with `ref` as the ref its host holds; the sheet's only (or first) modal is
 * the one checked.
 */
export function expectHostDismissGuarded(
  sheet: (ref: RefObject<BottomSheetModal | null>) => ReactElement,
) {
  const modal = wedgingModal();
  const ref = createRef<BottomSheetModal>();
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(sheet(ref), {
      createNodeMock: (element) =>
        element.type === "BottomSheetModal" ? modal : null,
    });
  });
  const props = () =>
    tree.root.findAll(
      (node) => (node.type as unknown) === "BottomSheetModal",
    )[0]!.props as {
      onAnimate?: (from: number, to: number) => void;
      onDismiss?: () => void;
    };

  // Blurred, or the channel switched, before the sheet was ever opened.
  act(() => ref.current?.dismiss());
  expect(modal.dismiss).not.toHaveBeenCalled();

  // So the next open still draws.
  act(() => ref.current?.present());
  expect(modal.wedged).toBe(false);
  expect(modal.shown).toBe(true);

  // Up: the host's dismiss closes it.
  act(() => props().onAnimate?.(-1, 0));
  act(() => ref.current?.dismiss());
  expect(modal.dismiss).toHaveBeenCalledTimes(1);

  // Closed again: a second blur leaves it alone, and it opens once more.
  act(() => props().onDismiss?.());
  act(() => ref.current?.dismiss());
  expect(modal.dismiss).toHaveBeenCalledTimes(1);
  act(() => ref.current?.present());
  expect(modal.wedged).toBe(false);
  expect(modal.shown).toBe(true);

  act(() => tree.unmount());
}

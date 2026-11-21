/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  IMPORTANT_JUMP_MAX_OLDER_PAGES,
  useJumpToImportant,
} from "./use-jump-to-important";

const rows = (...ids: string[]) => ids.map((id) => ({ message: { id } }));

type Props = {
  r: { message: { id: string } }[];
  hasOlder: boolean;
  isLoadingOlder: boolean;
  olderError: boolean;
  resetKey: string;
};

function setup(initial: Partial<Props> = {}) {
  const loadOlder = vi.fn();
  const jumpToMessage = vi.fn();
  const props: Props = {
    r: rows("a", "b"),
    hasOlder: true,
    isLoadingOlder: false,
    olderError: false,
    resetKey: "chan-1",
    ...initial,
  };
  const hook = renderHook(
    (p: Props) =>
      useJumpToImportant({
        rows: p.r,
        resetKey: p.resetKey,
        hasOlder: p.hasOlder,
        isLoadingOlder: p.isLoadingOlder,
        olderError: p.olderError,
        loadOlder,
        jumpToMessage,
      }),
    { initialProps: props },
  );
  return { ...hook, props, loadOlder, jumpToMessage };
}

describe("useJumpToImportant (#4186)", () => {
  it("jumps at once to a loaded message", () => {
    const { result, loadOlder, jumpToMessage } = setup();

    act(() => result.current.jumpToImportant("b"));

    expect(jumpToMessage).toHaveBeenCalledWith("b");
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it("pages older history for a message that isn't loaded, then jumps", () => {
    const { result, rerender, props, loadOlder, jumpToMessage } = setup();

    act(() => result.current.jumpToImportant("old"));
    expect(loadOlder).toHaveBeenCalledTimes(1);
    expect(jumpToMessage).not.toHaveBeenCalled();

    rerender({ ...props, isLoadingOlder: true });
    rerender({ ...props, r: rows("old", "a", "b"), isLoadingOlder: false });

    expect(jumpToMessage).toHaveBeenCalledWith("old");
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it("gives up when the history runs out", () => {
    const { result, loadOlder, jumpToMessage } = setup({ hasOlder: false });

    act(() => result.current.jumpToImportant("gone"));

    expect(loadOlder).not.toHaveBeenCalled();
    expect(jumpToMessage).not.toHaveBeenCalled();
  });

  it("stops after its page budget", () => {
    const { result, rerender, props, loadOlder } = setup();

    act(() => result.current.jumpToImportant("far"));
    for (let i = 0; i < IMPORTANT_JUMP_MAX_OLDER_PAGES + 3; i++) {
      rerender({ ...props, isLoadingOlder: true });
      rerender({
        ...props,
        r: rows(`p${i}`, ...props.r.map((x) => x.message.id)),
      });
    }

    expect(loadOlder).toHaveBeenCalledTimes(IMPORTANT_JUMP_MAX_OLDER_PAGES);
  });

  it("drops a jump in progress on a channel switch", () => {
    const { result, rerender, props, jumpToMessage } = setup();

    act(() => result.current.jumpToImportant("old"));
    rerender({ ...props, resetKey: "chan-2", r: rows("old") });

    expect(jumpToMessage).not.toHaveBeenCalled();
  });

  it("says why it gave up when the caller asked (#3723), and only then", () => {
    const missing = setup({ hasOlder: false });
    const onMiss = vi.fn();
    act(() => missing.result.current.jumpToImportant("gone", { onMiss }));
    expect(onMiss).toHaveBeenCalledWith("missing");

    const failed = setup({ olderError: true });
    act(() => failed.result.current.jumpToImportant("x", { onMiss }));
    expect(onMiss).toHaveBeenLastCalledWith("error");

    const far = setup();
    act(() => far.result.current.jumpToImportant("far", { onMiss }));
    for (let i = 0; i < IMPORTANT_JUMP_MAX_OLDER_PAGES + 1; i++) {
      far.rerender({ ...far.props, isLoadingOlder: true });
      far.rerender({
        ...far.props,
        r: rows(`p${i}`, ...far.props.r.map((x) => x.message.id)),
      });
    }
    expect(onMiss).toHaveBeenLastCalledWith("far");
    expect(onMiss).toHaveBeenCalledTimes(3);
  });
});

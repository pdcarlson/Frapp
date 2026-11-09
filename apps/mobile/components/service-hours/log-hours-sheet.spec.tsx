/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";
import {
  SERVICE_RECEIPT_REQUIRED_CODE,
  SERVICE_RECEIPT_REQUIRED_MESSAGE,
} from "@repo/validation";
import type { DispatchResult } from "@repo/chat-core/dispatch";
import { RECEIPT_REQUIRED_COPY } from "@/lib/more/service-proof";

/**
 * The Log hours sheet opened from a chat's + (#3865): it logs through the
 * channel's `postHours` (chat-core's, the call `/hours log` makes) and can
 * attach the proof the one-liner can't. The sheet's own rules, from the
 * Service page, are `lib/more/service-hours-screen.spec.tsx`'s.
 */

const mutate = vi.fn();
const requestProofUrl = vi.fn();
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCreateServiceEntry: () => ({ mutate, isPending: false }),
  useRequestServiceProofUploadUrl: () => ({ mutateAsync: requestProofUrl }),
}));

const pickProofPhoto = vi.fn<() => Promise<unknown>>();
const uploadProofPhoto = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/more/service-proof", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/more/service-proof")>()),
  pickProofPhoto: () => pickProofPhoto(),
  uploadProofPhoto: (...args: unknown[]) => uploadProofPhoto(...args),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: null }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const successHaptic = vi.fn();
vi.mock("@/lib/haptics", () => ({
  successHaptic: () => successHaptic(),
}));

import { LogHoursSheet } from "./log-hours-sheet";

const PHOTO = {
  uri: "file:///receipt.jpg",
  filename: "receipt.jpg",
  contentType: "image/jpeg",
  byteSize: 204_800,
};
const PATH = "chapters/c/service-proof/p/receipt.jpg";

const dismiss = vi.fn();

function render(
  postToChannel: (input: unknown) => Promise<DispatchResult>,
  onPosted = vi.fn(),
): ReactTestRenderer {
  const ref = React.createRef<never>();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <LogHoursSheet
          ref={ref}
          now={new Date("2026-09-27T12:00:00Z")}
          postToChannel={postToChannel}
          onPosted={onPosted}
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
  // What gorhom reports as `present()` starts bringing the sheet up.
  const modal = tree.root.find(
    (node) => node.type === ("BottomSheetModal" as never),
  );
  act(() => modal.props.onAnimate(-1, 0));
  return tree;
}

const submitButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      /^Submit(ting…| for approval)$/.test(drawnText(node)),
  );

function fill(tree: ReactTestRenderer) {
  const field = tree.root.find(
    (node) =>
      (node.type as unknown) === "BottomSheetTextInput" &&
      node.props.accessibilityLabel === "Service description",
  );
  act(() => field.props.onChangeText("Food bank"));
}

const descriptionValue = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "BottomSheetTextInput" &&
      node.props.accessibilityLabel === "Service description",
  ).props.value;

beforeEach(() => {
  mutate.mockReset();
  dismiss.mockReset();
  successHaptic.mockReset();
  pickProofPhoto.mockReset();
  uploadProofPhoto.mockReset();
});

describe("Log hours from a chat's + (#3865)", () => {
  it("logs through the channel with its proof, not the page's create", async () => {
    pickProofPhoto.mockResolvedValueOnce({ status: "picked", image: PHOTO });
    uploadProofPhoto.mockResolvedValueOnce({
      status: "uploaded",
      storagePath: PATH,
    });
    const postToChannel = vi.fn(async () => ({ ok: true }));
    const onPosted = vi.fn();
    const tree = render(postToChannel, onPosted);
    fill(tree);
    const addRow = tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        /^Add photo proof, /.test(String(node.props.accessibilityLabel)),
    );
    await act(async () => addRow.props.onPress());
    await act(async () => submitButton(tree).props.onPress());

    expect(mutate).not.toHaveBeenCalled();
    expect(postToChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Food bank",
        proof_path: PATH,
      }),
    );
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(descriptionValue(tree)).toBe("");
    expect(successHaptic).toHaveBeenCalledTimes(1);
    expect(onPosted).toHaveBeenCalledWith({ ok: true });
    act(() => tree.unmount());
  });

  it("closes on a lost answer, which may have written, without the success haptic", async () => {
    const lost = { ok: true, unconfirmed: true, warning: "Couldn't confirm." };
    const onPosted = vi.fn();
    const tree = render(vi.fn(async () => lost), onPosted);
    fill(tree);
    await act(async () => submitButton(tree).props.onPress());
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(descriptionValue(tree)).toBe("");
    expect(successHaptic).not.toHaveBeenCalled();
    expect(onPosted).toHaveBeenCalledWith(lost);
    act(() => tree.unmount());
  });

  it("asks for proof when the chapter requires it, reading the refusal's cause", async () => {
    const RECEIPT_MISSING = {
      statusCode: 400,
      error: "Bad Request",
      code: SERVICE_RECEIPT_REQUIRED_CODE,
      message: SERVICE_RECEIPT_REQUIRED_MESSAGE,
    };
    const onPosted = vi.fn();
    const tree = render(
      vi.fn(async () => ({
        ok: false,
        error: SERVICE_RECEIPT_REQUIRED_MESSAGE,
        cause: RECEIPT_MISSING,
      })),
      onPosted,
    );
    fill(tree);
    await act(async () => submitButton(tree).props.onPress());
    expect(dismiss).not.toHaveBeenCalled();
    expect(descriptionValue(tree)).toBe("Food bank");
    expect(screenText(tree)).toContain(RECEIPT_REQUIRED_COPY);
    expect(onPosted).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

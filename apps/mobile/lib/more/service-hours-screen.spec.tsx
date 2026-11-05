/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { drawnText, screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import {
  SERVICE_RECEIPT_REQUIRED_MESSAGE,
  moduleDisabledMessage,
} from "@repo/validation";
import { expectViewerScopedReads } from "@/test/service-entry-reads";
import { serviceDatePresets } from "@/lib/more/service-hours";
import {
  PROOF_SIZE_REFUSAL,
  RECEIPT_REQUIRED_COPY,
} from "@/lib/more/service-proof";

/**
 * The s20 "Log service hours" sheet on a subscription refusal (#2410), the
 * fourth paid-ops write surface after the three #2297 fixed.
 *
 * `POST /v1/service-entries` carries no `@FreeTier`, so a brand-new chapter
 * (`incomplete` until checkout) is refused on every submit. A refusal
 * withdraws Submit, because retrying is the one thing that cannot work until
 * an officer sorts out billing. An ordinary failed save keeps Submit and its
 * "try again" copy. The module gate (`@RequireModule('hours')`, #2718) is the
 * other refusal retrying can't win, and gets the same treatment.
 *
 * It renders `app/(tabs)/service-hours.tsx`, and through it the sheet in
 * `components/service-hours/log-hours-sheet.tsx`, but lives here: a spec under
 * `app/` ships as a route module (`lib/routes.spec.ts`).
 */

/** What `ChapterGuard` throws for a chapter that never finished checkout. */
const REFUSED = {
  statusCode: 403,
  error: "Forbidden",
  message:
    "Chapter subscription is not active; complete checkout to use this feature.",
  requestId: "req_refused",
};

/**
 * What `ChapterGuard` throws when an officer has switched `hours` off (#2718),
 * shaped like the real filter output but without its `code`: only the message
 * identifies it on installed builds and an API older than #1020.
 */
const MODULE_OFF = {
  statusCode: 403,
  error: "Forbidden",
  message: moduleDisabledMessage("hours"),
  requestId: "req_module_off",
};

/**
 * A 403 that is NOT either gate. `service-entry.controller.ts`
 * carries a `@RequirePermissions` on this route, and a denial there recovers
 * once an officer grants the role, so it must keep its retry.
 */
const DENIED = {
  statusCode: 403,
  error: "Forbidden",
  message: "No roles assigned",
  requestId: "req_denied",
};

/** Any failure that is not the subscription gate. */
const FAILED = {
  statusCode: 500,
  error: "Internal Server Error",
  message: "Service entry service is unavailable.",
  requestId: "req_failed",
};

const TRY_AGAIN = "That didn't save. Your entry is still here — try again.";

let failure: unknown = REFUSED;
interface MutateOptions {
  onSuccess: () => void;
  onError: (error: unknown) => void;
}
const failNow = (_body: unknown, options: MutateOptions) =>
  options.onError(failure);
const mutate = vi.fn(failNow);
let isPending = false;

let viewerUserId: string | null = "user-1";
let entries: unknown[] = [];
const useServiceEntries = vi.fn<(...args: unknown[]) => unknown>(() => ({
  data: entries,
  isPending: false,
  isError: false,
  isSuccess: true,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useViewerUserId: () => viewerUserId,
  useCurrentUser: () => ({ isError: false }),
  useServiceEntries: (...args: unknown[]) => useServiceEntries(...args),
  useCreateServiceEntry: () => ({ mutate, isPending }),
  useRequestServiceProofUploadUrl: () => ({ mutateAsync: requestProofUrl }),
}));

const requestProofUrl = vi.fn();
const pickProofPhoto = vi.fn<() => Promise<unknown>>();
const uploadProofPhoto = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@/lib/more/service-proof", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/more/service-proof")>()),
  pickProofPhoto: () => pickProofPhoto(),
  uploadProofPhoto: (...args: unknown[]) => uploadProofPhoto(...args),
}));

/** `null` online; the offline copy from `lib/connection/state.ts` otherwise. */
let writeBlockedReason: string | null = null;

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const successHaptic = vi.fn();
vi.mock("@/lib/haptics", () => ({
  successHaptic: () => successHaptic(),
}));

import ServiceHoursScreen from "@/app/(tabs)/service-hours";

/** Stands in for gorhom's modal instance, so a spec can see `dismiss()`. */
const dismiss = vi.fn();
const present = vi.fn();

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ServiceHoursScreen />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal"
            ? { dismiss, present }
            : null,
      },
    );
  });
  // What gorhom reports as `present()` starts bringing the sheet up.
  act(() => modal(tree).props.onAnimate(-1, 0));
  return tree;
}

const modal = (tree: ReactTestRenderer) =>
  tree.root.find((node) => (node.type as unknown) === "BottomSheetModal");

const pressable = (tree: ReactTestRenderer, text: string) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) && drawnText(node) === text,
  );

/** The sheet's primary action. */
const submitButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      /^Submit(ting…| for approval)$/.test(drawnText(node)),
  );

const stepButton = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      node.props.accessibilityLabel === label,
  );

const logButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      node.props.accessibilityLabel === "Log service hours",
  );

function fill(tree: ReactTestRenderer) {
  const field = tree.root.find(
    (node) =>
      (node.type as unknown) === "BottomSheetTextInput" &&
      node.props.accessibilityLabel === "Service description",
  );
  act(() => field.props.onChangeText("Food bank"));
}

function submitEntry(tree: ReactTestRenderer) {
  fill(tree);
  expect(submitButton(tree).props.disabled).toBe(false);
  act(() => submitButton(tree).props.onPress());
}

beforeEach(() => {
  mutate.mockReset();
  mutate.mockImplementation(failNow);
  dismiss.mockReset();
  successHaptic.mockReset();
  pickProofPhoto.mockReset();
  uploadProofPhoto.mockReset();
  isPending = false;
  entries = [];
  writeBlockedReason = null;
  viewerUserId = "user-1";
});

describe("Service hours on a subscription refusal (#2410)", () => {

  it("explains the refusal and withdraws Submit", () => {
    failure = REFUSED;
    const tree = render();
    submitEntry(tree);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.serviceHours);
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    expect(successHaptic).not.toHaveBeenCalled();
    // The server's own words are a purchase instruction, which the store
    // declaration forbids inside the app.
    expect(screenText(tree)).not.toContain(REFUSED.message);
    expect(submitButton(tree).props.disabled).toBe(true);
    // A screen reader lands on the disabled button, so the reason rides on it.
    expect(submitButton(tree).props.accessibilityHint).toBe(
      SUBSCRIPTION_REFUSAL_COPY.serviceHours,
    );
    act(() => tree.unmount());
  });

  // The direction that got an earlier attempt at #2297 reverted: only a
  // refusal may withdraw the retry. The 403 is the trap: a bare status check
  // would take the retry from a permission denial, which recovers once an
  // officer grants the role.
  it.each([
    ["an ordinary failure", FAILED],
    ["a 403 that is neither gate", DENIED],
  ])("keeps Submit and its retry copy after %s", (_label, error) => {
    failure = error;
    const tree = render();
    submitEntry(tree);

    expect(screenText(tree)).toContain(TRY_AGAIN);
    expect(screenText(tree)).not.toContain(
      SUBSCRIPTION_REFUSAL_COPY.serviceHours,
    );
    expect(screenText(tree)).not.toContain(MODULE_REFUSAL_COPY.serviceHours);
    expect(submitButton(tree).props.disabled).toBe(false);
    expect(submitButton(tree).props.accessibilityHint).toBeUndefined();
    act(() => tree.unmount());
  });

  it("drops an earlier failure's retry copy when the next submit is refused", () => {
    // Otherwise "try again" sits beside the refusal under a disabled Submit,
    // the contradiction this fix exists to remove.
    failure = FAILED;
    const tree = render();
    submitEntry(tree);
    expect(screenText(tree)).toContain(TRY_AGAIN);

    failure = REFUSED;
    act(() => submitButton(tree).props.onPress());

    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.serviceHours);
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    expect(submitButton(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("names the refusal, not the connection, on the button when both apply", () => {
    // Reconnecting clears the offline block and leaves the refusal, so a hint
    // naming only the connection would promise a fix that doesn't come.
    failure = REFUSED;
    const tree = render();
    submitEntry(tree);

    writeBlockedReason = "Reconnect to make changes.";
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <ServiceHoursScreen />
        </FrappThemeProvider>,
      ),
    );

    expect(submitButton(tree).props.disabled).toBe(true);
    expect(submitButton(tree).props.accessibilityHint).toBe(
      SUBSCRIPTION_REFUSAL_COPY.serviceHours,
    );
    act(() => tree.unmount());
  });

  it("clears the refusal once the sheet closes", () => {
    // A tab screen is never unmounted, so without the reset an officer fixing
    // billing would leave Submit dead until a force-quit. Reopening is the
    // member's deliberate second try.
    failure = REFUSED;
    const tree = render();
    submitEntry(tree);
    expect(submitButton(tree).props.disabled).toBe(true);

    act(() => modal(tree).props.onDismiss());

    expect(screenText(tree)).not.toContain(
      SUBSCRIPTION_REFUSAL_COPY.serviceHours,
    );
    expect(submitButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });
});

describe("Service hours on a module-off refusal (#2718)", () => {
  it("explains a module-off refusal in the member's terms and withdraws Submit", () => {
    failure = MODULE_OFF;
    const tree = render();
    submitEntry(tree);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain(MODULE_REFUSAL_COPY.serviceHours);
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    // The guard's own words tell an officer to go to Settings → Modules.
    expect(screenText(tree)).not.toContain(MODULE_OFF.message);
    expect(submitButton(tree).props.disabled).toBe(true);
    expect(submitButton(tree).props.accessibilityHint).toBe(
      MODULE_REFUSAL_COPY.serviceHours,
    );
    act(() => tree.unmount());
  });

  it("clears a module-off refusal once the sheet closes", () => {
    // An officer may have turned hours back on since, and reopening is the
    // member's deliberate second try, not a retry in place.
    failure = MODULE_OFF;
    const tree = render();
    submitEntry(tree);
    expect(submitButton(tree).props.disabled).toBe(true);

    act(() => modal(tree).props.onDismiss());

    expect(screenText(tree)).not.toContain(MODULE_REFUSAL_COPY.serviceHours);
    expect(submitButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });
});

/**
 * `GET /v1/service-entries` is not scoped by the endpoint alone, so this
 * screen, which lists the entries and totals them as the viewer's own hours,
 * must ask for the viewer's entries. It once didn't, and an
 * officer saw the chapter's entries, unnamed, totalled as their own.
 * `profile-screen.spec.tsx` pins the same for s12.
 */
describe("Service hours reads only the viewer's entries", () => {
  beforeEach(() => {
    useServiceEntries.mockClear();
  });

  it("asks for the viewer's entries once the viewer is known", () => {
    viewerUserId = "user-1";
    const tree = render();
    expectViewerScopedReads(useServiceEntries.mock.calls, "user-1");
    act(() => tree.unmount());
  });

  it("sends nothing while the viewer is still unknown", () => {
    viewerUserId = null;
    const tree = render();
    expectViewerScopedReads(useServiceEntries.mock.calls, null);
    act(() => tree.unmount());
  });
});

/**
 * #3022. The board never drew this screen, but it opens from a More row like
 * s10–s16, so it draws the same `‹ More`.
 */
describe("Service hours back row (#3022)", () => {
  it("draws ‹ More above the title", () => {
    const tree = render();
    expectBackRow(tree, "More", "/more");
    tree.unmount();
  });
});

/**
 * s20 on the shared sheet chrome, with the board's stepper (finding 26 of the
 * 2026-11 polish audit). The duration is never typed, so Android's full
 * keyboard never opens for it, and the date can be a recent day rather than
 * always today.
 */
describe("Log service hours sheet", () => {
  const sent = () =>
    mutate.mock.calls[0]?.[0] as {
      date: string;
      duration_minutes: number;
      description: string;
    };

  it("opens from the header's + tile", () => {
    present.mockClear();
    const tree = render();
    act(() => logButton(tree).props.onPress());
    expect(present).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("dims the screen behind it", () => {
    const tree = render();
    expect(modal(tree).props.backdropComponent).toBeDefined();
    act(() => tree.unmount());
  });

  it("posts the stepper's duration and the chosen day", () => {
    const tree = render();
    fill(tree);
    // One hour to start; two taps up is two hours, one down is an hour and a half.
    act(() => stepButton(tree, "Half an hour more").props.onPress());
    act(() => stepButton(tree, "Half an hour more").props.onPress());
    act(() => stepButton(tree, "Half an hour less").props.onPress());
    expect(screenText(tree)).toContain("1.5");
    act(() => pressable(tree, "Yesterday").props.onPress());
    act(() => submitButton(tree).props.onPress());

    expect(sent()).toEqual({
      date: serviceDatePresets(new Date())[1]?.date,
      duration_minutes: 90,
      description: "Food bank",
    });
    act(() => tree.unmount());
  });

  it("files today's date unless another day is picked", () => {
    const tree = render();
    submitEntry(tree);
    expect(sent().date).toBe(serviceDatePresets(new Date())[0]?.date);
    expect(sent().duration_minutes).toBe(60);
    act(() => tree.unmount());
  });

  it("stops the stepper at half an hour", () => {
    const tree = render();
    act(() => stepButton(tree, "Half an hour less").props.onPress());
    expect(stepButton(tree, "Half an hour less").props.disabled).toBe(true);
    expect(stepButton(tree, "Half an hour more").props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("holds Submit until there's a description", () => {
    const tree = render();
    expect(submitButton(tree).props.disabled).toBe(true);
    fill(tree);
    expect(submitButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("closes and clears the draft when the entry saves", () => {
    mutate.mockImplementation((_body, options) => options.onSuccess());
    const tree = render();
    submitEntry(tree);

    expect(dismiss).toHaveBeenCalledTimes(1);
    const field = tree.root.find(
      (node) => node.props.accessibilityLabel === "Service description",
    );
    expect(field.props.value).toBe("");
    // The confirming action's haptic (`spec/ui/mobile/README.md`).
    expect(successHaptic).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  // gorhom's `dismiss()` on a modal that already closed leaves it stuck
  // mid-dismiss, and the next `present()` draws nothing (#3405).
  it("doesn't dismiss again when a save lands after the sheet closed", () => {
    let succeed = () => {};
    mutate.mockImplementation((_body, options) => {
      succeed = options.onSuccess;
    });
    const tree = render();
    submitEntry(tree);
    act(() => modal(tree).props.onDismiss());
    act(() => succeed());
    expect(dismiss).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("leaves a sheet reopened mid-save open when the save lands", () => {
    let succeed = () => {};
    mutate.mockImplementation((_body, options) => {
      succeed = options.onSuccess;
    });
    const tree = render();
    submitEntry(tree);
    act(() => modal(tree).props.onDismiss());
    act(() => modal(tree).props.onAnimate(-1, 0)); // reopened
    act(() => succeed());
    expect(dismiss).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  const descriptionField = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        (node.type as unknown) === "BottomSheetTextInput" &&
        node.props.accessibilityLabel === "Service description",
    );

  const cancelButton = (tree: ReactTestRenderer) => pressable(tree, "Cancel");

  it("keeps the entry through a swipe or scrim close", () => {
    const tree = render();
    fill(tree);
    act(() => stepButton(tree, "Half an hour more").props.onPress());
    act(() => pressable(tree, "Yesterday").props.onPress());

    act(() => modal(tree).props.onDismiss());
    act(() => modal(tree).props.onAnimate(-1, 0)); // reopened

    expect(descriptionField(tree).props.value).toBe("Food bank");
    act(() => submitButton(tree).props.onPress());
    expect(sent()).toEqual(
      expect.objectContaining({
        duration_minutes: 90,
        date: serviceDatePresets(new Date())[1]?.date,
      }),
    );
    act(() => tree.unmount());
  });

  it("gives the entry up on Cancel", () => {
    const tree = render();
    fill(tree);
    act(() => stepButton(tree, "Half an hour more").props.onPress());
    act(() => pressable(tree, "Yesterday").props.onPress());

    act(() => cancelButton(tree).props.onPress());

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(descriptionField(tree).props.value).toBe("");
    fill(tree);
    act(() => submitButton(tree).props.onPress());
    expect(sent()).toEqual(
      expect.objectContaining({
        duration_minutes: 60,
        date: serviceDatePresets(new Date())[0]?.date,
      }),
    );
    act(() => tree.unmount());
  });

  it.each([
    ["a subscription refusal", REFUSED, SUBSCRIPTION_REFUSAL_COPY.serviceHours],
    ["a module-off refusal", MODULE_OFF, MODULE_REFUSAL_COPY.serviceHours],
    ["an ordinary failure", FAILED, TRY_AGAIN],
  ])(
    "doesn't carry %s that lands after the sheet closed into the next visit",
    (_label, error, copy) => {
      let settle = () => {};
      mutate.mockImplementation((_body, options) => {
        settle = () => options.onError(error);
      });
      const tree = render();
      submitEntry(tree);
      act(() => modal(tree).props.onDismiss());
      act(() => modal(tree).props.onAnimate(-1, 0)); // reopened
      act(() => settle());

      expect(screenText(tree)).not.toContain(copy);
      expect(submitButton(tree).props.disabled).toBe(false);
      act(() => tree.unmount());
    },
  );

  it("reads one hour as singular to a screen reader", () => {
    const tree = render();
    const value = () =>
      tree.root.find(
        (node) =>
          node.props.accessibilityRole === "adjustable" &&
          node.props.accessibilityLabel === "Hours",
      ).props.accessibilityValue.text;
    expect(value()).toBe("1 hour");
    act(() => stepButton(tree, "Half an hour more").props.onPress());
    expect(value()).toBe("1.5 hours");
    act(() => stepButton(tree, "Half an hour less").props.onPress());
    act(() => stepButton(tree, "Half an hour less").props.onPress());
    expect(value()).toBe("0.5 hours");
    act(() => tree.unmount());
  });

  // The draft is read-only while the save runs, which is what lets a success
  // clear it without clearing anything the member typed after sending.
  it("holds the draft still while a save is in flight", () => {
    const tree = render();
    fill(tree);
    isPending = true;
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <ServiceHoursScreen />
        </FrappThemeProvider>,
      ),
    );

    expect(descriptionField(tree).props.editable).toBe(false);
    expect(stepButton(tree, "Half an hour more").props.disabled).toBe(true);
    expect(stepButton(tree, "Half an hour less").props.disabled).toBe(true);
    const adjustable = tree.root.find(
      (node) =>
        node.props.accessibilityRole === "adjustable" &&
        node.props.accessibilityLabel === "Hours",
    );
    act(() =>
      adjustable.props.onAccessibilityAction({
        nativeEvent: { actionName: "increment" },
      }),
    );
    act(() => pressable(tree, "Yesterday").props.onPress());

    isPending = false;
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <ServiceHoursScreen />
        </FrappThemeProvider>,
      ),
    );
    act(() => submitButton(tree).props.onPress());
    expect(sent()).toEqual(
      expect.objectContaining({
        duration_minutes: 60,
        date: serviceDatePresets(new Date())[0]?.date,
      }),
    );
    act(() => tree.unmount());
  });

  it("sends one entry however often Submit is pressed mid-save", () => {
    mutate.mockImplementation(() => {});
    const tree = render();
    fill(tree);
    act(() => {
      submitButton(tree).props.onPress();
      submitButton(tree).props.onPress();
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

/**
 * Drawn like Dues and Study, with no narrating meta (finding 33 of the 2026-11
 * polish audit).
 */
describe("Service hours summary and history", () => {
  const entry = (overrides: Record<string, unknown>) => ({
    id: "e-1",
    description: "Food bank shift",
    status: "APPROVED",
    duration_minutes: 150,
    date: "2026-10-27",
    ...overrides,
  });

  it("leads with approved hours and counts what is pending", () => {
    entries = [
      entry({ id: "a" }),
      entry({ id: "b", status: "PENDING", duration_minutes: 60 }),
      entry({ id: "c", status: "PENDING", duration_minutes: 60 }),
    ];
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Approved hours");
    expect(text).toContain("2.5");
    expect(text).toContain("2 pending");
    expect(text).not.toContain("awaiting review");
    act(() => tree.unmount());
  });

  it("says nothing about pending when nothing is", () => {
    entries = [entry({})];
    const tree = render();
    expect(screenText(tree)).not.toMatch(/pending|review/i);
    act(() => tree.unmount());
  });

  it("labels each history row's status", () => {
    entries = [
      entry({ id: "a", status: "APPROVED" }),
      entry({ id: "b", status: "PENDING" }),
      entry({ id: "c", status: "REJECTED" }),
    ];
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Approved");
    expect(text).toContain("Pending");
    expect(text).toContain("Rejected");
    act(() => tree.unmount());
  });
});

/**
 * The board's "Add photo proof" row. The photo goes up on Submit, not on
 * pick, so a change of mind leaves nothing in the bucket, and its storage path
 * rides on the create as `proof_path`. A chapter that requires proof
 * (`wf_hours_receipt`, on by default) used to read as "try again" forever.
 */
describe("Log service hours photo proof", () => {
  const PHOTO = {
    uri: "file:///receipt.jpg",
    filename: "receipt.jpg",
    contentType: "image/jpeg",
    byteSize: 204_800,
  };
  const PATH = "chapters/c/service-proof/p/receipt.jpg";

  /** What `ServiceEntryService.create` throws without proof on a receipt chapter. */
  const RECEIPT_MISSING = {
    statusCode: 400,
    error: "Bad Request",
    message: SERVICE_RECEIPT_REQUIRED_MESSAGE,
    requestId: "req_receipt",
  };

  const sentBody = () => mutate.mock.calls.at(-1)?.[0] as Record<string, unknown>;

  const addRow = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        /^Add photo proof, /.test(String(node.props.accessibilityLabel)),
    );

  const removeButton = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        /^Remove photo proof/.test(String(node.props.accessibilityLabel)),
    );

  async function attach(tree: ReactTestRenderer) {
    pickProofPhoto.mockResolvedValueOnce({ status: "picked", image: PHOTO });
    await act(async () => addRow(tree).props.onPress());
  }

  it("offers proof as optional, as drawn", () => {
    const tree = render();
    expect(addRow(tree).props.accessibilityLabel).toBe(
      "Add photo proof, optional",
    );
    expect(screenText(tree)).toContain("Add photo proof");
    expect(screenText(tree)).toContain("optional");
    act(() => tree.unmount());
  });

  it("shows the picked photo with Remove, and uploads nothing yet", async () => {
    const tree = render();
    await attach(tree);

    expect(screenText(tree)).toContain("receipt.jpg");
    expect(uploadProofPhoto).not.toHaveBeenCalled();
    act(() => removeButton(tree).props.onPress());
    expect(screenText(tree)).not.toContain("receipt.jpg");
    expect(addRow(tree)).toBeDefined();
    act(() => tree.unmount());
  });

  it("says why a pick was refused", async () => {
    const tree = render();
    pickProofPhoto.mockResolvedValueOnce({
      status: "refused",
      reason: PROOF_SIZE_REFUSAL,
    });
    await act(async () => addRow(tree).props.onPress());
    expect(screenText(tree)).toContain(PROOF_SIZE_REFUSAL);
    act(() => tree.unmount());
  });

  it("uploads on Submit, then posts the entry with its proof path", async () => {
    mutate.mockImplementation(() => {});
    let finish: (value: unknown) => void = () => {};
    uploadProofPhoto.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const tree = render();
    fill(tree);
    await attach(tree);
    act(() => submitButton(tree).props.onPress());

    // The PUT is running: the row says so and the draft holds still.
    expect(screenText(tree)).toContain("Uploading…");
    expect(removeButton(tree).props.disabled).toBe(true);
    expect(submitButton(tree).props.disabled).toBe(true);
    expect(uploadProofPhoto.mock.calls[0]?.[0]).toBe(PHOTO);
    expect(mutate).not.toHaveBeenCalled();

    await act(async () => finish({ status: "uploaded", storagePath: PATH }));

    expect(sentBody()).toEqual({
      date: serviceDatePresets(new Date())[0]?.date,
      duration_minutes: 60,
      description: "Food bank",
      proof_path: PATH,
    });
    act(() => tree.unmount());
  });

  it("keeps the entry and the photo when the upload fails", async () => {
    uploadProofPhoto.mockResolvedValueOnce({
      status: "refused",
      reason: "Couldn't upload that photo. Try again in a moment.",
      final: false,
    });
    const tree = render();
    fill(tree);
    await attach(tree);
    await act(async () => submitButton(tree).props.onPress());

    expect(mutate).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(
      "Couldn't upload that photo. Try again in a moment.",
    );
    expect(screenText(tree)).toContain("receipt.jpg");
    expect(
      tree.root.find(
        (node) =>
          (node.type as unknown) === "BottomSheetTextInput" &&
          node.props.accessibilityLabel === "Service description",
      ).props.value,
    ).toBe("Food bank");
    expect(submitButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("withdraws Submit when the upload is refused by a gate", async () => {
    uploadProofPhoto.mockResolvedValueOnce({
      status: "refused",
      reason: SUBSCRIPTION_REFUSAL_COPY.serviceHours,
      final: true,
    });
    const tree = render();
    fill(tree);
    await attach(tree);
    await act(async () => submitButton(tree).props.onPress());

    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.serviceHours);
    expect(submitButton(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("retries a failed create with the bytes already sent", async () => {
    failure = FAILED;
    uploadProofPhoto.mockResolvedValue({ status: "uploaded", storagePath: PATH });
    const tree = render();
    fill(tree);
    await attach(tree);
    await act(async () => submitButton(tree).props.onPress());
    expect(screenText(tree)).toContain(TRY_AGAIN);

    act(() => submitButton(tree).props.onPress());

    expect(uploadProofPhoto).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(sentBody().proof_path).toBe(PATH);
    act(() => tree.unmount());
  });

  it("asks for a photo when the chapter requires proof, and holds Submit until one is attached", async () => {
    failure = RECEIPT_MISSING;
    const tree = render();
    submitEntry(tree);

    expect(screenText(tree)).toContain(RECEIPT_REQUIRED_COPY);
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    // The server's own words name a "signed slip" the phone can't send.
    expect(screenText(tree)).not.toContain(SERVICE_RECEIPT_REQUIRED_MESSAGE);
    expect(addRow(tree).props.accessibilityLabel).toBe(
      "Add photo proof, required",
    );
    expect(submitButton(tree).props.disabled).toBe(true);
    expect(submitButton(tree).props.accessibilityHint).toBe(
      RECEIPT_REQUIRED_COPY,
    );

    await attach(tree);

    expect(screenText(tree)).not.toContain(RECEIPT_REQUIRED_COPY);
    expect(submitButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("keeps the photo through a scrim close and gives it up on Cancel", async () => {
    const tree = render();
    await attach(tree);

    act(() => modal(tree).props.onDismiss());
    act(() => modal(tree).props.onAnimate(-1, 0)); // reopened
    expect(screenText(tree)).toContain("receipt.jpg");

    act(() => pressable(tree, "Cancel").props.onPress());
    expect(screenText(tree)).not.toContain("receipt.jpg");
    act(() => tree.unmount());
  });
});

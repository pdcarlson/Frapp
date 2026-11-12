/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppState } from "react-native";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { drawnText, screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import {
  SERVICE_DESCRIPTION_MAX_LENGTH,
  SERVICE_RECEIPT_REQUIRED_CODE,
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
 * It renders `app/(app)/service-hours.tsx`, and through it the sheet in
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
let chapterId: string | null = "chapter-a";
let entries: unknown[] = [];
const viewerRefetch = vi.fn(() => Promise.resolve());
const entriesRefetch = vi.fn(() => Promise.resolve());
const useServiceEntries = vi.fn<(...args: unknown[]) => unknown>(
  (...args: unknown[]) => ({
    data: entries,
    isPending: false,
    isError: false,
    isSuccess: true,
    // A real result reports its own `enabled`, which the screen gates on the
    // viewer's id.
    isEnabled: (args[2] as { enabled?: boolean } | undefined)?.enabled,
    refetch: entriesRefetch,
  }),
);

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useViewerUserId: () => viewerUserId,
  useActiveChapterId: () => chapterId,
  useCurrentUser: () => ({ isError: false, refetch: viewerRefetch }),
  useServiceEntries: (...args: unknown[]) => useServiceEntries(...args),
  usePermissionList: () => permissions.list,
  useCreateServiceEntry: () => ({ mutate, isPending }),
  useRequestServiceProofUploadUrl: () => ({ mutateAsync: requestProofUrl }),
}));

/** The viewer's permissions; a member who logs hours unless a test says so. */
const permissions = vi.hoisted(() => ({ list: ["service:log"] as string[] }));

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

import ServiceHoursScreen from "@/app/(app)/service-hours";

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
    (node) => node.type === ("Pressable" as never) && drawnText(node) === text,
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
  chapterId = "chapter-a";
});

/** Re-renders the screen, as a hook's new value would. */
function rerender(tree: ReactTestRenderer) {
  act(() =>
    tree.update(
      <FrappThemeProvider>
        <ServiceHoursScreen />
      </FrappThemeProvider>,
    ),
  );
}

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
    // The screen can stay up for days, so without the reset an officer fixing
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
 * `packages/hooks/src/profile-stats.hook.spec.tsx` pins the same for the
 * Profile cards (s15) on both apps.
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
 * #3385. A pull refetches what the screen reads, through the ScrollView's
 * `refreshControl` that `ScreenShell` draws.
 */
describe("Service hours pull to refresh (#3385)", () => {
  beforeEach(() => {
    viewerRefetch.mockClear();
    entriesRefetch.mockClear();
  });

  async function pull(tree: ReactTestRenderer) {
    const scroll = tree.root.find(
      (node) =>
        node.type === ("ScrollView" as never) && !!node.props.refreshControl,
    );
    await act(async () => {
      await scroll.props.refreshControl.props.refresh();
    });
  }

  it("refreshes the viewer and their service entries on a pull (#3385)", async () => {
    const tree = render();
    await pull(tree);
    expect(viewerRefetch).toHaveBeenCalledWith({ cancelRefetch: true });
    expect(entriesRefetch).toHaveBeenCalledWith({ cancelRefetch: true });
    act(() => tree.unmount());
  });

  it("leaves the entries alone on a pull while the viewer is unknown", async () => {
    viewerUserId = null;
    const tree = render();
    await pull(tree);
    expect(viewerRefetch).toHaveBeenCalledTimes(1);
    expect(entriesRefetch).not.toHaveBeenCalled();
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
 * s20 on the shared sheet chrome, with the board's stepper. The duration is
 * never typed, so Android's full
 * keyboard never opens for it, and the date can be a recent day rather than
 * always today.
 */
describe("Service hours with nothing logged (empty-states plan rule 7)", () => {
  it("says so in one line, pointing a member who can log to +", () => {
    const tree = render();
    expect(screenText(tree)).toContain(
      "No service logged yet. Tap + to log your first hours.",
    );
    act(() => tree.unmount());
  });

  it("leaves out the + pointer for a role that can't log hours", () => {
    permissions.list = ["members:view"];
    try {
      const tree = render();
      expect(screenText(tree)).toContain("No service logged yet.");
      expect(screenText(tree)).not.toContain("Tap +");
      act(() => tree.unmount());
    } finally {
      permissions.list = ["service:log"];
    }
  });
});

describe("Log service hours sheet", () => {
  const sent = () =>
    mutate.mock.calls[0]?.[0] as {
      date: string;
      duration_minutes: number;
      description: string;
    };

  it("opens from the floating create button", () => {
    present.mockClear();
    const tree = render();
    act(() => logButton(tree).props.onPress());
    expect(present).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("isn't offered to a role that can't log hours", () => {
    permissions.list = ["members:view"];
    try {
      const tree = render();
      expect(
        tree.root.findAll(
          (node) =>
            node.type === ("Pressable" as never) &&
            node.props.accessibilityLabel === "Log service hours",
        ),
      ).toHaveLength(0);
    } finally {
      permissions.list = ["service:log"];
    }
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

  it("holds Cancel while a save is in flight, and a swipe still keeps the entry", () => {
    // The save can't be called back: a Cancel then would clear an entry that
    // gets filed anyway, or one whose failure no visit hears of.
    mutate.mockImplementation(() => {});
    const tree = render();
    expect(cancelButton(tree).props.disabled).toBe(false);
    submitEntry(tree);
    isPending = true;
    rerender(tree);

    expect(cancelButton(tree).props.disabled).toBe(true);
    expect(cancelButton(tree).props.accessibilityState).toEqual({
      disabled: true,
    });

    act(() => modal(tree).props.onDismiss());
    act(() => modal(tree).props.onAnimate(-1, 0)); // reopened
    expect(descriptionField(tree).props.value).toBe("Food bank");
    isPending = false;
    rerender(tree);
    expect(cancelButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("does nothing on a Cancel in the same batch as Submit", () => {
    // Both presses run before `isPending` reaches a render, so the Cancel the
    // member reached was not drawn disabled yet; `sending` holds it instead.
    let fail = () => {};
    mutate.mockImplementation((_body, options) => {
      fail = () => options.onError(FAILED);
    });
    const tree = render();
    fill(tree);
    const cancel = cancelButton(tree);
    act(() => {
      submitButton(tree).props.onPress();
      cancel.props.onPress();
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(dismiss).not.toHaveBeenCalled();
    expect(descriptionField(tree).props.value).toBe("Food bank");

    // The create fails: the visit hears of it, and the entry is still there
    // for the retry, or for a Cancel that now gives it up.
    act(() => fail());
    expect(screenText(tree)).toContain(TRY_AGAIN);
    expect(descriptionField(tree).props.value).toBe("Food bank");
    act(() => cancelButton(tree).props.onPress());
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(descriptionField(tree).props.value).toBe("");
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

  it("caps the description at the API's limit", () => {
    // Past it the API answers a 400 the sheet can only read as "try again",
    // and with a photo held, as a refused path that uploads it again.
    const tree = render();
    expect(descriptionField(tree).props.maxLength).toBe(
      SERVICE_DESCRIPTION_MAX_LENGTH,
    );
    act(() => tree.unmount());
  });
});

/**
 * The date chips across a day change. "Today" and "Yesterday" are relative; a
 * weekday chip names a date, which a kept entry holds. The host's clock moves
 * when the app comes back to the foreground, driven here through the
 * screen's own `AppState` listener, and reopening is gorhom's `onAnimate`,
 * which moves no clock of its own.
 */
describe("Log service hours date across a day", () => {
  /** The listener the screen registered last with the mocked `AppState`. */
  function appStateListener(): (state: string) => void {
    const calls = vi.mocked(AppState.addEventListener).mock.calls;
    return calls[calls.length - 1]![1] as (state: string) => void;
  }

  /** The app goes to the background and comes back at `at`. */
  function foregroundAt(at: Date) {
    act(() => appStateListener()("background"));
    vi.setSystemTime(at);
    act(() => appStateListener()("active"));
  }

  const weekday = (day: Date) =>
    day.toLocaleDateString(undefined, { weekday: "short" });
  const chip = (tree: ReactTestRenderer, label: string) =>
    pressable(tree, label);
  const isSelected = (tree: ReactTestRenderer, label: string) =>
    chip(tree, label).props.accessibilityState.selected as boolean;
  const chipLabels = (tree: ReactTestRenderer) =>
    tree.root
      .find((node) => node.props.accessibilityLabel === "Date of service")
      .props.chips.map((each: { label: string }) => each.label);
  const sentDate = () =>
    (mutate.mock.calls.at(-1)?.[0] as { date: string }).date;

  // Sunday 2026-11-01 through Thursday the 5th.
  const sunday = new Date(2026, 10, 1, 12);
  const monday = new Date(2026, 10, 2, 12);
  const wednesdayEvening = new Date(2026, 10, 4, 20);
  const thursdayMorning = new Date(2026, 10, 5, 8);

  /** Opens the sheet on `pickedOn`, fills it, and picks `label`. */
  function pickOn(pickedOn: Date, label: string) {
    vi.setSystemTime(pickedOn);
    const tree = render();
    fill(tree);
    act(() => chip(tree, label).props.onPress());
    return tree;
  }

  /** A swipe, the app left overnight, and the sheet reopened at `at`. */
  function keptUntil(tree: ReactTestRenderer, at: Date) {
    act(() => modal(tree).props.onDismiss());
    foregroundAt(at);
    act(() => modal(tree).props.onAnimate(-1, 0));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    return () => vi.useRealTimers();
  });

  it("files the new day under Today on a sheet left up overnight", () => {
    vi.setSystemTime(new Date(2026, 10, 1, 23, 50));
    const tree = render();
    fill(tree);

    foregroundAt(new Date(2026, 10, 2, 8));

    expect(isSelected(tree, "Today")).toBe(true);
    act(() => submitButton(tree).props.onPress());
    expect(sentDate()).toBe("2026-11-02");
    act(() => tree.unmount());
  });

  it("reads a kept Yesterday against the day it is filed", () => {
    const tree = pickOn(wednesdayEvening, "Yesterday");
    keptUntil(tree, thursdayMorning);

    expect(isSelected(tree, "Yesterday")).toBe(true);
    act(() => submitButton(tree).props.onPress());
    expect(sentDate()).toBe("2026-11-04");
    act(() => tree.unmount());
  });

  it("files a kept weekday chip on its date, under the chip that names it now", () => {
    // Wednesday's chips end Mon, Sun; Thursday's end Tue, Mon.
    const tree = pickOn(wednesdayEvening, weekday(monday));
    keptUntil(tree, thursdayMorning);

    expect(chipLabels(tree)).toEqual([
      "Today",
      "Yesterday",
      weekday(new Date(2026, 10, 3, 12)),
      weekday(monday),
    ]);
    expect(isSelected(tree, weekday(monday))).toBe(true);
    act(() => submitButton(tree).props.onPress());
    expect(sentDate()).toBe("2026-11-02");
    act(() => tree.unmount());
  });

  it("files a kept date that has left the chips as Today", () => {
    const tree = pickOn(wednesdayEvening, weekday(sunday));
    keptUntil(tree, thursdayMorning);

    expect(chipLabels(tree)).not.toContain(weekday(sunday));
    expect(isSelected(tree, "Today")).toBe(true);
    act(() => submitButton(tree).props.onPress());
    expect(sentDate()).toBe("2026-11-05");
    act(() => tree.unmount());
  });
});

/**
 * Drawn like Dues and Study, with no narrating meta.
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

  it("shows each title whole rather than clamped", () => {
    // The row can't be opened, so it is the only place to read a rejected
    // entry's whole description.
    const long = "Food bank shift. ".repeat(40).trim();
    entries = [entry({ description: long })];
    const tree = render();
    const title = tree.root
      .findAllByType("Text" as never)
      .find((node) => node.props.children === long);
    expect(title).toBeDefined();
    expect(title?.props.numberOfLines).toBeUndefined();
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
    code: SERVICE_RECEIPT_REQUIRED_CODE,
    message: SERVICE_RECEIPT_REQUIRED_MESSAGE,
    requestId: "req_receipt",
  };

  /** What `assertValidProofPath` throws for a path from another chapter. */
  const PATH_REFUSED = {
    statusCode: 400,
    error: "Bad Request",
    message:
      "proof_path must be a storage path within the chapter service-proof folder",
    requestId: "req_path",
  };

  const sentBody = () =>
    mutate.mock.calls.at(-1)?.[0] as Record<string, unknown>;

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

  it("opens the library once for two taps in one batch", async () => {
    // Before `picking` renders, the row is still enabled for the second tap,
    // and Android rejects a second launch.
    let resolvePick: (value: unknown) => void = () => {};
    pickProofPhoto.mockImplementation(
      () => new Promise((resolve) => (resolvePick = resolve)),
    );
    const tree = render();
    await act(async () => {
      const row = addRow(tree);
      row.props.onPress();
      row.props.onPress();
    });

    expect(pickProofPhoto).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain("Opening…");
    await act(async () => resolvePick({ status: "picked", image: PHOTO }));
    expect(screenText(tree)).toContain("receipt.jpg");
    act(() => tree.unmount());
  });

  it("opens no library from a tap in the same batch as Submit", async () => {
    mutate.mockImplementation(() => {});
    pickProofPhoto.mockImplementation(() => new Promise(() => {}));
    const tree = render();
    fill(tree);
    const row = addRow(tree);
    await act(async () => {
      submitButton(tree).props.onPress();
      row.props.onPress();
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(pickProofPhoto).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("keeps the photo through a Remove in the same batch as Submit", async () => {
    // Submit is already uploading this photo and will file the entry with
    // it, so the row must not clear before `locked` renders.
    mutate.mockImplementation(() => {});
    let finish: (value: unknown) => void = () => {};
    uploadProofPhoto.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const tree = render();
    fill(tree);
    await attach(tree);
    const remove = removeButton(tree);
    act(() => {
      submitButton(tree).props.onPress();
      remove.props.onPress();
    });

    expect(screenText(tree)).toContain("receipt.jpg");
    await act(async () => finish({ status: "uploaded", storagePath: PATH }));
    expect(sentBody().proof_path).toBe(PATH);
    expect(screenText(tree)).toContain("receipt.jpg");
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
    uploadProofPhoto.mockResolvedValue({
      status: "uploaded",
      storagePath: PATH,
    });
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

  it("reads the same words without the code as an ordinary failure", () => {
    // The code is the contract: matching the English sentence would break
    // every installed build the day it is reworded.
    failure = { ...RECEIPT_MISSING, code: undefined };
    const tree = render();
    submitEntry(tree);

    expect(screenText(tree)).toContain(TRY_AGAIN);
    expect(screenText(tree)).not.toContain(RECEIPT_REQUIRED_COPY);
    expect(addRow(tree).props.accessibilityLabel).toBe(
      "Add photo proof, optional",
    );
    act(() => tree.unmount());
  });

  it("asks for proof for one visit only", () => {
    // An officer may have turned the workflow off by the next one.
    failure = RECEIPT_MISSING;
    const tree = render();
    submitEntry(tree);
    expect(submitButton(tree).props.disabled).toBe(true);

    act(() => modal(tree).props.onDismiss());
    act(() => modal(tree).props.onAnimate(-1, 0)); // reopened

    expect(screenText(tree)).not.toContain(RECEIPT_REQUIRED_COPY);
    expect(addRow(tree).props.accessibilityLabel).toBe(
      "Add photo proof, optional",
    );
    expect(submitButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it.each([
    [
      "a gate refusal",
      {
        status: "refused",
        reason: SUBSCRIPTION_REFUSAL_COPY.serviceHours,
        final: true,
      },
    ],
    [
      "a failed upload",
      {
        status: "refused",
        reason: "Couldn't upload that photo. Try again in a moment.",
        final: false,
      },
    ],
  ])(
    "doesn't carry %s that lands after the sheet closed into the next visit",
    async (_label, result) => {
      let settle: (value: unknown) => void = () => {};
      uploadProofPhoto.mockImplementationOnce(
        () => new Promise((resolve) => (settle = resolve)),
      );
      const tree = render();
      fill(tree);
      await attach(tree);
      act(() => submitButton(tree).props.onPress());
      act(() => modal(tree).props.onDismiss());
      act(() => modal(tree).props.onAnimate(-1, 0)); // reopened
      await act(async () => settle(result));

      expect(screenText(tree)).not.toContain(result.reason);
      expect(submitButton(tree).props.disabled).toBe(false);
      act(() => tree.unmount());
    },
  );

  it("holds Cancel while the photo uploads", async () => {
    uploadProofPhoto.mockImplementationOnce(() => new Promise(() => {}));
    const tree = render();
    fill(tree);
    await attach(tree);
    act(() => submitButton(tree).props.onPress());

    expect(screenText(tree)).toContain("Uploading…");
    expect(pressable(tree, "Cancel").props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("does nothing on a Cancel in the same batch as a Submit that uploads", async () => {
    // A Cancel handled before the held Cancel reached a render: the upload
    // goes on to file the entry, so the Cancel must not have given it up.
    let finish: (value: unknown) => void = () => {};
    uploadProofPhoto.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    mutate.mockImplementation((_body, options) => options.onSuccess());
    const tree = render();
    fill(tree);
    await attach(tree);
    const cancel = pressable(tree, "Cancel");
    act(() => {
      submitButton(tree).props.onPress();
      cancel.props.onPress();
    });
    expect(dismiss).not.toHaveBeenCalled();
    expect(
      tree.root.find(
        (node) =>
          (node.type as unknown) === "BottomSheetTextInput" &&
          node.props.accessibilityLabel === "Service description",
      ).props.value,
    ).toBe("Food bank");
    expect(screenText(tree)).toContain("receipt.jpg");

    await act(async () => finish({ status: "uploaded", storagePath: PATH }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ description: "Food bank", proof_path: PATH }),
    );
    // The save, not the Cancel, closed the sheet.
    expect(dismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("uploads again when the API turns the held path down", async () => {
    failure = PATH_REFUSED;
    uploadProofPhoto.mockResolvedValue({
      status: "uploaded",
      storagePath: PATH,
    });
    const tree = render();
    fill(tree);
    await attach(tree);
    await act(async () => submitButton(tree).props.onPress());
    expect(screenText(tree)).toContain(TRY_AGAIN);
    // The photo stays; only its path goes.
    expect(screenText(tree)).toContain("receipt.jpg");

    await act(async () => submitButton(tree).props.onPress());

    expect(uploadProofPhoto).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });

  it("starts a new sheet when the member switches chapter", async () => {
    // A held path is minted under the chapter it was sent from.
    failure = FAILED;
    uploadProofPhoto.mockResolvedValue({
      status: "uploaded",
      storagePath: PATH,
    });
    const tree = render();
    fill(tree);
    await attach(tree);
    await act(async () => submitButton(tree).props.onPress());
    expect(screenText(tree)).toContain(TRY_AGAIN);

    chapterId = "chapter-b";
    rerender(tree);

    expect(screenText(tree)).not.toContain("receipt.jpg");
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    act(() => tree.unmount());
  });
});

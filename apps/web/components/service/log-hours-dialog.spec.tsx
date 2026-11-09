import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import type { DispatchResult, HoursInput } from "@repo/chat-core/dispatch";

const { mockCreateEntry, mockToast } = vi.hoisted(() => ({
  mockCreateEntry: vi.fn().mockResolvedValue({}),
  mockToast: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCreateServiceEntry: () => ({ mutateAsync: mockCreateEntry }),
  useRequestServiceProofUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useOrgConfig: () => ({ data: undefined }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const { LogHoursDialog } = await import("./log-hours-dialog");

// An open gate: the dialog only reads `controlProps`, and the notice renders
// nothing while `allowed`.
const OPEN_GATE = {
  allowed: true,
  isOffline: false,
  controlProps: (busy?: boolean) => ({
    disabled: Boolean(busy),
    title: undefined,
    "aria-describedby": undefined,
  }),
} as unknown as SubscriptionGate;

function renderInChat(
  submitToChannel: (input: HoursInput) => Promise<DispatchResult>,
) {
  const onOpenChange = vi.fn();
  render(
    <LogHoursDialog
      open
      onOpenChange={onOpenChange}
      gate={OPEN_GATE}
      submitToChannel={submitToChannel}
    />,
  );
  fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "1.5" } });
  fireEvent.change(screen.getByLabelText("What did you do?"), {
    target: { value: "Food bank" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
  return onOpenChange;
}

describe("LogHoursDialog posting into a chat channel (#3865)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("logs through chat, not the Service page's write, and closes", async () => {
    const submitToChannel = vi.fn().mockResolvedValue({ ok: true });
    const onOpenChange = renderInChat(submitToChannel);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(submitToChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        duration_minutes: 90,
        description: "Food bank",
        proof_path: undefined,
      }),
    );
    expect(mockCreateEntry).not.toHaveBeenCalled();
  });

  it("stays open with the draft when chat refuses it", async () => {
    const submitToChannel = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Proof is required" });
    const onOpenChange = renderInChat(submitToChannel);
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Proof is required" }),
      ),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("What did you do?")).toHaveValue("Food bank");
  });
});

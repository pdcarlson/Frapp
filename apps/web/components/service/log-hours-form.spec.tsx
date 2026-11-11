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

// The notice has its own spec; here it only shows whether the form renders it.
vi.mock("@/components/shared/subscription-gate", () => ({
  SubscriptionNotice: () => <p role="status">blocked</p>,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const { LogHoursForm } = await import("./log-hours-form");

// An open gate: the form only reads `controlProps`, and the notice renders
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

function renderInCard(
  submitToChannel: (input: HoursInput) => Promise<DispatchResult>,
) {
  const onDone = vi.fn();
  render(
    <LogHoursForm
      layout="card"
      gate={OPEN_GATE}
      submitToChannel={submitToChannel}
      onDone={onDone}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "1.5" } });
  fireEvent.change(screen.getByLabelText("What did you do?"), {
    target: { value: "Food bank" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
  return onDone;
}

describe("LogHoursForm in the + card (#3865, #3983)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("logs through chat, not the Service page's write, and is done", async () => {
    const submitToChannel = vi.fn().mockResolvedValue({ ok: true });
    const onDone = renderInCard(submitToChannel);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
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
    const onDone = renderInCard(submitToChannel);
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Proof is required" }),
      ),
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText("What did you do?")).toHaveValue("Food bank");
  });

  it("names a missing field in place and focuses it, with no toast", async () => {
    const submitToChannel = vi.fn();
    render(
      <LogHoursForm
        layout="card"
        gate={OPEN_GATE}
        submitToChannel={submitToChannel}
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    expect(
      await screen.findByText("Enter at least one minute of time."),
    ).toBeInTheDocument();
    expect(screen.getByText("Say what you did.")).toBeInTheDocument();
    expect(screen.getByLabelText("Hours")).toHaveFocus();
    expect(screen.getByLabelText("Hours")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(submitToChannel).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe("LogHoursForm's subscription notice", () => {
  it("leaves the notice to the host unless asked, so the Service page shows one", () => {
    const props = {
      layout: "dialog" as const,
      gate: OPEN_GATE,
      onDone: vi.fn(),
      onCancel: vi.fn(),
    };
    const { rerender } = render(<LogHoursForm {...props} />);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<LogHoursForm {...props} showSubscriptionNotice />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

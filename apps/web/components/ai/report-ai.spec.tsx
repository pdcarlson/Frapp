import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_REPORT_COPY, aiReportAttachedLine } from "@repo/validation";

const state = vi.hoisted(() => ({
  policy: {
    data: undefined as
      { keeps_text: boolean; retention_days: number } | null | undefined,
    isError: false,
  },
  report: vi.fn(),
  pending: false,
}));

vi.mock("@repo/hooks", () => ({
  useAiReportPolicy: () => state.policy,
  useReportAi: () => ({ mutateAsync: state.report, isPending: state.pending }),
}));

const { ReportAiButton } = await import("./report-ai");
type AiReportTarget = import("./report-ai").AiReportTarget;

const ASK: AiReportTarget = {
  subject: "ask_answer",
  subjectId: "11111111-1111-4111-8111-111111111111",
  receipt: "v1.k1.n.t.c",
};

async function openSheet(target = ASK) {
  const user = userEvent.setup();
  render(<ReportAiButton target={target} />);
  await user.click(screen.getByRole("button", { name: AI_REPORT_COPY.action }));
  return user;
}

describe("ReportAiButton (#4315)", () => {
  beforeEach(() => {
    state.policy = {
      data: { keeps_text: true, retention_days: 30 },
      isError: false,
    };
    state.report.mockReset();
    state.pending = false;
  });

  it("says what goes with the report, who reads it and for how long, before Send", async () => {
    await openSheet();
    expect(screen.getByText(AI_REPORT_COPY.who_reads)).toBeInTheDocument();
    expect(screen.getByTestId("ai-report-attached")).toHaveTextContent(
      aiReportAttachedLine("ask_answer", true),
    );
  });

  it("says nothing of the text is kept when the server holds no key", async () => {
    state.policy.data = { keeps_text: false, retention_days: 30 };
    await openSheet();
    expect(screen.getByTestId("ai-report-attached")).toHaveTextContent(
      aiReportAttachedLine("ask_answer", false),
    );
  });

  it("says nothing of an answer is kept when it came with no receipt", async () => {
    await openSheet({ ...ASK, receipt: null });
    expect(screen.getByTestId("ai-report-attached")).toHaveTextContent(
      aiReportAttachedLine("ask_answer", false),
    );
  });

  it("says the most a report could keep when the policy can't be read", async () => {
    state.policy = { data: undefined, isError: true };
    await openSheet();
    expect(screen.getByTestId("ai-report-attached")).toHaveTextContent(
      aiReportAttachedLine("ask_answer", true),
    );
  });

  it("holds Send until the server has said what is kept", async () => {
    state.policy = { data: undefined, isError: false };
    const user = await openSheet();
    await user.click(screen.getByLabelText(AI_REPORT_COPY.reasons.wrong));
    expect(
      screen.getByRole("button", { name: AI_REPORT_COPY.send }),
    ).toBeDisabled();
    expect(screen.getByTestId("ai-report-attached")).toBeEmptyDOMElement();
  });

  it("needs a reason, then sends the receipt and the note, and the button turns to Reported", async () => {
    state.report.mockResolvedValue({
      already_reported: false,
      kept_text: true,
      expires_at: "2026-12-12T00:00:00.000Z",
    });
    const user = await openSheet();
    const send = screen.getByRole("button", { name: AI_REPORT_COPY.send });
    expect(send).toBeDisabled();
    await user.click(screen.getByLabelText(AI_REPORT_COPY.reasons.wrong));
    await user.type(
      screen.getByLabelText(AI_REPORT_COPY.note_label),
      "Dues are $200",
    );
    await user.click(send);
    expect(state.report).toHaveBeenCalledWith({
      subject: "ask_answer",
      subjectId: ASK.subjectId,
      reason: "wrong",
      note: "Dues are $200",
      receipt: ASK.receipt,
    });
    expect(
      await screen.findByText(AI_REPORT_COPY.sent_title),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: AI_REPORT_COPY.done }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: AI_REPORT_COPY.reported }),
      ).toBeDisabled(),
    );
  });

  it("tells a member who already reported it, without a second report", async () => {
    state.report.mockResolvedValue({
      already_reported: true,
      kept_text: false,
      expires_at: "2026-12-12T00:00:00.000Z",
    });
    const user = await openSheet();
    await user.click(screen.getByLabelText(AI_REPORT_COPY.reasons.other));
    await user.click(screen.getByRole("button", { name: AI_REPORT_COPY.send }));
    expect(
      await screen.findByText(AI_REPORT_COPY.already_title),
    ).toBeInTheDocument();
  });

  it("says an answer is too old in plain words", async () => {
    state.report.mockRejectedValue({ code: "ai.report.too_old" });
    const user = await openSheet();
    await user.click(screen.getByLabelText(AI_REPORT_COPY.reasons.wrong));
    await user.click(screen.getByRole("button", { name: AI_REPORT_COPY.send }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      AI_REPORT_COPY.too_old,
    );
    // The member can try again from the same sheet.
    expect(
      screen.getByRole("button", { name: AI_REPORT_COPY.send }),
    ).toBeEnabled();
  });

  it("names what is reported on the icon-only flag", () => {
    render(
      <ReportAiButton
        iconOnly
        name="Book the venue"
        target={{ subject: "ai_suggestion", subjectId: ASK.subjectId }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Report Book the venue" }),
    ).toBeInTheDocument();
  });
});

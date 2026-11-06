import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_REPORT_DETAILS_MAX_LENGTH } from "@repo/hooks";
import {
  REPORT_ALREADY_TITLE,
  REPORT_SENT_BODY,
  REPORT_UNAVAILABLE_BODY,
} from "@repo/chat-core/report-copy";

const mocks = vi.hoisted(() => ({ report: vi.fn(), isPending: false }));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useReportMessage: () => ({
      mutateAsync: mocks.report,
      isPending: mocks.isPending,
    }),
  };
});

const { ReportMessageDialog } = await import("./report-message-dialog");

beforeEach(() => {
  mocks.report.mockReset();
  mocks.isPending = false;
});

describe("ReportMessageDialog (#2687)", () => {
  it("files the chosen reason and details, then says where it went", async () => {
    mocks.report.mockResolvedValue({ alreadyReported: false });
    const onBlock = vi.fn();
    const onClose = vi.fn();
    render(
      <ReportMessageDialog
        target={{ messageId: "msg-1", onBlock, blockLabel: "Block Alice Chen" }}
        onClose={onClose}
      />,
    );
    const send = screen.getByRole("button", { name: "Send report" });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Spam" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Details (optional)" }),
      "Same link five times",
    );
    await userEvent.click(send);
    expect(mocks.report).toHaveBeenCalledWith({
      messageId: "msg-1",
      reason: "spam",
      details: "Same link five times",
    });
    expect(await screen.findByText(REPORT_SENT_BODY)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Block Alice Chen" }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(onBlock).toHaveBeenCalled();
  });

  it("caps details at the API's limit, as mobile does", () => {
    render(
      <ReportMessageDialog
        target={{ messageId: "msg-1", blockLabel: null }}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("textbox", { name: "Details (optional)" }),
    ).toHaveAttribute("maxLength", String(CHAT_REPORT_DETAILS_MAX_LENGTH));
  });

  it("cannot be closed while the report is out", async () => {
    let settle: (value: { alreadyReported: boolean }) => void = () => {};
    mocks.report.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    mocks.isPending = true;
    const onClose = vi.fn();
    render(
      <ReportMessageDialog
        target={{ messageId: "msg-1", blockLabel: null }}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
    settle({ alreadyReported: false });
  });

  it("does not claim a second report when one is already open", async () => {
    mocks.report.mockResolvedValue({ alreadyReported: true });
    render(
      <ReportMessageDialog
        target={{ messageId: "msg-1", blockLabel: null }}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Spam" }));
    await userEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText(REPORT_ALREADY_TITLE)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Block/ }),
    ).not.toBeInTheDocument();
  });

  it("says when trying again cannot help", async () => {
    mocks.report.mockRejectedValue({ statusCode: 409 });
    render(
      <ReportMessageDialog
        target={{ messageId: "msg-1", blockLabel: null }}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("radio", { name: "Harassment or bullying" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      REPORT_UNAVAILABLE_BODY,
    );
  });
});

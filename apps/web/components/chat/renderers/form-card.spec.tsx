import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ChatMessage } from "@repo/chat-core/types";
import { FormCard } from "./form-card";
import { FormFillHost } from "../form-fill-dialog";

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  PUT: vi.fn(),
  permissions: [] as string[],
}));
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFrappClient: () => ({ GET: api.GET, PUT: api.PUT }),
    useMyPermissions: () => ({ data: { permissions: api.permissions } }),
  };
});
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function form(extra: Record<string, unknown> = {}): ChatMessage {
  return {
    id: "m1",
    channel_id: "c1",
    sender_id: "u9",
    content: "Formal housing",
    kind: "form",
    payload: {
      title: "Formal housing",
      description: "Pick by Friday",
      questions: [
        {
          id: "room",
          type: "multiple_choice",
          title: "What room do you want?",
          required: true,
          options: [
            { id: "single", label: "Single" },
            { id: "double", label: "Double" },
          ],
        },
        {
          id: "notes",
          type: "short_answer",
          title: "Anything else?",
          required: false,
        },
      ],
      ...extra,
    },
    actions: [],
  } as unknown as ChatMessage;
}

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FormFillHost>{node}</FormFillHost>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.permissions = [];
});

describe("FormCard (#3926 step 3)", () => {
  it("shows the title and question count, and Fill out before the viewer answers", async () => {
    api.GET.mockResolvedValue({ data: { response: null } });
    wrap(<FormCard message={form()} viewerId="u1" isConfirmed />);
    expect(screen.getByText("Formal housing")).toBeInTheDocument();
    expect(screen.getByText("2 questions")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Fill out" }),
    ).toBeInTheDocument();
  });

  it("offers Edit your answers once the viewer has answered", async () => {
    api.GET.mockResolvedValue({
      data: {
        response: { answers: { room: "single" }, updated_at: "2026-11-13" },
      },
    });
    wrap(<FormCard message={form()} viewerId="u1" isConfirmed />);
    expect(
      await screen.findByRole("button", { name: "Edit your answers" }),
    ).toBeInTheDocument();
  });

  it("says Closed and offers View on a closed form", async () => {
    api.GET.mockResolvedValue({ data: { response: null } });
    wrap(
      <FormCard
        message={form({ closed_at: "2026-11-12T00:00:00Z", closed_by: "u9" })}
        viewerId="u1"
        isConfirmed
      />,
    );
    expect(screen.getByText(/Closed/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "View" })).toBeEnabled();
  });

  it("opens the full-page form, holds a blank required answer, then sends", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue({ data: { response: null } });
    api.PUT.mockResolvedValue({
      data: { answers: { room: "double" }, updated_at: "2026-11-13" },
    });
    wrap(<FormCard message={form()} viewerId="u1" isConfirmed />);
    await user.click(await screen.findByRole("button", { name: "Fill out" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(
      within(dialog).getByText("This question is required."),
    ).toBeInTheDocument();
    expect(api.PUT).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("radio", { name: "Double" }));
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(api.PUT).toHaveBeenCalledWith(
        "/v1/channels/messages/{messageId}/form-response",
        {
          params: { path: { messageId: "m1" } },
          body: { answers: { room: "double" } },
        },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("button", { name: "Edit your answers" }),
    ).toBeInTheDocument();
  });

  it("shows the server's refusal in the form and keeps it open", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue({ data: { response: null } });
    api.PUT.mockResolvedValue({
      error: { message: "This form is closed" },
    });
    wrap(<FormCard message={form()} viewerId="u1" isConfirmed />);
    await user.click(await screen.findByRole("button", { name: "Fill out" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Single" }));
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(
      await within(dialog).findByText("This form is closed"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers Close form to its creator, not to another member", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue({ data: { response: null } });
    const onClose = vi.fn();
    const { unmount } = wrap(
      <FormCard
        message={{ ...form(), _status: "confirmed" } as ChatMessage}
        viewerId="u1"
        isConfirmed
        onCloseCard={onClose}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Close form" }),
    ).not.toBeInTheDocument();
    unmount();

    wrap(
      <FormCard
        message={{ ...form(), _status: "confirmed" } as ChatMessage}
        viewerId="u9"
        isConfirmed
        onCloseCard={onClose}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Close form" }));
    expect(onClose).toHaveBeenCalledWith("m1", "form");
  });
});

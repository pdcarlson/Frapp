import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ChatMessage } from "@repo/chat-core/types";
import { FormCard } from "./form-card";
import { FormFillHost } from "../form-fill-dialog";
import { FormResponsesHost } from "../form-responses-dialog";
import { memberFallbackLabel } from "@repo/hooks";

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
const exported = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    exportRows: async (...args: unknown[]) => {
      exported.calls.push(args);
    },
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
  // The app's staleTime (`makeQueryClient`), so the dialog's open-time read is
  // its own and not useQuery's refetch of a stale copy.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  const tree = (inner: ReactNode) => (
    <QueryClientProvider client={client}>
      <FormFillHost>
        <FormResponsesHost>{inner}</FormResponsesHost>
      </FormFillHost>
    </QueryClientProvider>
  );
  const result = render(tree(node));
  return {
    ...result,
    client,
    rerender: (next: ReactNode) => result.rerender(tree(next)),
  };
}

const nameFor = (id: string) =>
  ({ u1: "Ann Lee", u2: "Bo Park", u3: "Cy Diaz" })[id] ?? null;

const SAVED = {
  data: {
    response: { answers: { room: "single" }, updated_at: "2026-11-13" },
  },
};

afterEach(() => {
  onlineManager.setOnline(true);
});

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.permissions = [];
});

describe("FormCard (#3926 step 3)", () => {
  it("shows the title and question count, and Fill out before the viewer answers", async () => {
    api.GET.mockResolvedValue({ data: { response: null } });
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
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
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
    expect(
      await screen.findByRole("button", { name: "Edit your answers" }),
    ).toBeInTheDocument();
  });

  it("says Closed and offers View on a closed form", async () => {
    api.GET.mockResolvedValue({ data: { response: null } });
    wrap(
      <FormCard
        nameFor={nameFor}
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
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
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
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
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
        nameFor={nameFor}
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
        nameFor={nameFor}
        message={{ ...form(), _status: "confirmed" } as ChatMessage}
        viewerId="u9"
        isConfirmed
        onCloseCard={onClose}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Close form" }));
    expect(onClose).toHaveBeenCalledWith("m1", "form");
  });
  it("opens a closed form read-only, with the answers that were sent", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue(SAVED);
    wrap(
      <FormCard
        nameFor={nameFor}
        message={form({ closed_at: "2026-11-12T00:00:00Z", closed_by: "u9" })}
        viewerId="u1"
        isConfirmed
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "View your answers" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(
        "This form is closed. These are the answers you sent.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Single" })).toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: "Double" }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("textbox")).toHaveAttribute("readonly");
    expect(
      within(dialog).queryByRole("button", { name: /Send|Update answers/ }),
    ).not.toBeInTheDocument();
  });

  it("opens Edit your answers with the saved answers, to update", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue(SAVED);
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Edit your answers" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByRole("radio", { name: "Single" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("button", { name: "Update answers" }),
    ).toBeEnabled();
  });

  it("turns the open form read-only when it is closed while open", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue({ data: { response: null } });
    const { rerender } = wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
    await user.click(await screen.findByRole("button", { name: "Fill out" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Double" }));

    rerender(
      <FormCard
        nameFor={nameFor}
        message={form({ closed_at: "2026-11-13T00:00:00Z", closed_by: "u9" })}
        viewerId="u1"
        isConfirmed
      />,
    );
    expect(
      await within(dialog).findByText(
        "This form is closed. You didn't answer it.",
      ),
    ).toBeInTheDocument();
    // The unsent pick isn't shown as sent.
    expect(
      within(dialog).getByRole("radio", { name: "Double" }),
    ).not.toBeChecked();
    expect(
      within(dialog).queryByRole("button", { name: "Send" }),
    ).not.toBeInTheDocument();
  });

  it("takes the open form down when its card is deleted", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue({ data: { response: null } });
    const { rerender } = wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
    await user.click(await screen.findByRole("button", { name: "Fill out" }));
    await screen.findByRole("dialog");
    rerender(
      <FormCard
        nameFor={nameFor}
        message={{ ...form(), is_deleted: true } as ChatMessage}
        viewerId="u1"
        isConfirmed
      />,
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps a second form open when the first one's save lands late", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue({ data: { response: null } });
    let land: (value: unknown) => void = () => {};
    api.PUT.mockReturnValue(new Promise((resolve) => (land = resolve)));
    const second = {
      ...form({ title: "Rides" }),
      id: "m2",
      content: "Rides",
    } as ChatMessage;
    wrap(
      <>
        <FormCard
          nameFor={nameFor}
          message={form()}
          viewerId="u1"
          isConfirmed
        />
        <FormCard
          nameFor={nameFor}
          message={second}
          viewerId="u1"
          isConfirmed
        />
      </>,
    );
    // Both cards read Fill out once their own answers have loaded.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Fill out" })).toHaveLength(
        2,
      ),
    );
    const [first, other] = screen.getAllByRole("button", { name: "Fill out" });
    await user.click(first!);
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Single" }));
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await user.click(other!);
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Rides")).toBeInTheDocument();
    land({ data: { answers: { room: "single" }, updated_at: "2026-11-13" } });
    await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("holds edits and Send until the open-time read lands, then shows the newest answers", async () => {
    const user = userEvent.setup();
    // The card's copy says Single; answers sent from the phone since say
    // Double, and the dialog's read of them is still in flight.
    let land: (value: unknown) => void = () => {};
    const fresh = new Promise((resolve) => (land = resolve));
    api.GET.mockResolvedValueOnce(SAVED).mockReturnValue(fresh);
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Edit your answers" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Single" })).toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: "Double" }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("textbox")).toHaveAttribute("readonly");
    expect(
      within(dialog).getByRole("button", { name: "Update answers" }),
    ).toBeDisabled();

    land({
      data: {
        response: { answers: { room: "double" }, updated_at: "2026-11-14" },
      },
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("radio", { name: "Double" }),
      ).toBeChecked(),
    );
    expect(within(dialog).getByRole("radio", { name: "Single" })).toBeEnabled();
    expect(within(dialog).getByRole("textbox")).not.toHaveAttribute("readonly");
    expect(
      within(dialog).getByRole("button", { name: "Update answers" }),
    ).toBeEnabled();
  });

  it("reads once on open, joining a read already in flight", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue(SAVED);
    const { client } = wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
    const edit = await screen.findByRole("button", {
      name: "Edit your answers",
    });
    // The card's copy is a minute old: stale for the dialog's useQuery, which
    // starts a read of its own as it mounts.
    client.setQueryData(["chat", "form-response", "m1"], SAVED.data.response, {
      updatedAt: Date.now() - 60_000,
    });
    await user.click(edit);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Update answers" }),
      ).toBeEnabled(),
    );
    // The card's read, then the dialog's one.
    expect(api.GET).toHaveBeenCalledTimes(2);
  });

  it("lets the cached answers be edited when the open-time read fails", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValueOnce(SAVED).mockResolvedValue({
      error: { message: "Server error" },
    });
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Edit your answers" }),
    );
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Update answers" }),
      ).toBeEnabled(),
    );
    expect(within(dialog).getByRole("radio", { name: "Single" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Double" })).toBeEnabled();
  });

  it("lets the cached answers be edited when the open-time read waits for the network", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue(SAVED);
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
    const edit = await screen.findByRole("button", {
      name: "Edit your answers",
    });
    onlineManager.setOnline(false);
    await user.click(edit);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Update answers" }),
      ).toBeEnabled(),
    );
    expect(within(dialog).getByRole("radio", { name: "Double" })).toBeEnabled();
  });

  it("holds a reopened form until a save sent before it closed lands and is read again", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue(SAVED);
    let land: (value: unknown) => void = () => {};
    api.PUT.mockReturnValue(new Promise((resolve) => (land = resolve)));
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Edit your answers" }),
    );
    let dialog = await screen.findByRole("dialog");
    const double = within(dialog).getByRole("radio", { name: "Double" });
    await waitFor(() => expect(double).toBeEnabled());
    await user.click(double);
    await user.click(
      within(dialog).getByRole("button", { name: "Update answers" }),
    );
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    // Reopened while the save is in flight: its read still says Single.
    await user.click(screen.getByRole("button", { name: "Edit your answers" }));
    dialog = await screen.findByRole("dialog");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(dialog).getByRole("radio", { name: "Single" })).toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: "Double" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Update answers" }),
    ).toBeDisabled();

    api.GET.mockResolvedValue({
      data: {
        response: { answers: { room: "double" }, updated_at: "2026-11-14" },
      },
    });
    land({ data: { answers: { room: "double" }, updated_at: "2026-11-14" } });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Update answers" }),
      ).toBeEnabled(),
    );
    expect(within(dialog).getByRole("radio", { name: "Double" })).toBeChecked();
  });

  it("re-reads rather than writes the cache when a save lands after the page closed", async () => {
    const user = userEvent.setup();
    api.GET.mockResolvedValue({ data: { response: null } });
    let land: (value: unknown) => void = () => {};
    api.PUT.mockReturnValue(new Promise((resolve) => (land = resolve)));
    const { client } = wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
    const write = vi.spyOn(client, "setQueryData");
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await user.click(await screen.findByRole("button", { name: "Fill out" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      await within(dialog).findByRole("radio", { name: "Single" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    land({ data: { answers: { room: "single" }, updated_at: "2026-11-13" } });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["chat", "form-response", "m1"],
      }),
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("offers Close form to a channels:manage holder who didn't post it", () => {
    api.GET.mockResolvedValue({ data: { response: null } });
    api.permissions = ["channels:manage"];
    wrap(
      <FormCard
        nameFor={nameFor}
        message={{ ...form(), _status: "confirmed" } as ChatMessage}
        viewerId="u1"
        isConfirmed
        onCloseCard={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Close form" }),
    ).toBeInTheDocument();
  });
});

describe("FormCard responses (#3926 step 4)", () => {
  const RESPONSES = {
    data: {
      responses: [
        {
          user_id: "u1",
          answers: { room: "single", notes: "Near the stairs" },
          created_at: "2026-11-13T10:00:00Z",
          updated_at: "2026-11-13T10:00:00Z",
        },
        {
          user_id: "gone-member-id",
          answers: { room: "double" },
          created_at: "2026-11-13T11:00:00Z",
          updated_at: "2026-11-13T11:00:00Z",
        },
        {
          // Skipped the optional room question's sibling: answered notes only.
          user_id: "u2",
          answers: { notes: "Late arrival" },
          created_at: "2026-11-13T12:00:00Z",
          updated_at: "2026-11-13T12:00:00Z",
        },
      ],
      not_responded: ["u3", "unnamed-member"],
    },
  };
  const routeGets = () =>
    api.GET.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("form-responses")
          ? RESPONSES
          : { data: { response: null } },
      ),
    );

  it("offers Responses only to the member who posted the form", async () => {
    routeGets();
    const { rerender } = wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u1" isConfirmed />,
    );
    expect(
      screen.queryByRole("button", { name: "Responses" }),
    ).not.toBeInTheDocument();
    rerender(
      <FormCard nameFor={nameFor} message={form()} viewerId="u9" isConfirmed />,
    );
    expect(screen.getByRole("button", { name: "Responses" })).toBeEnabled();
  });

  it("opens a summary, each person's answers and who hasn't answered", async () => {
    routeGets();
    const user = userEvent.setup();
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u9" isConfirmed />,
    );
    await user.click(screen.getByRole("button", { name: "Responses" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("3 responses")).toBeInTheDocument();
    expect(api.GET).toHaveBeenCalledWith(
      "/v1/channels/messages/{messageId}/form-responses",
      { params: { path: { messageId: "m1" } } },
    );
    // Summary: a share of those who answered the question (2 of 3), not of
    // every response, and the text answers.
    expect(within(dialog).getAllByText("2 of 3 answered")).toHaveLength(2);
    expect(within(dialog).getAllByText("1 · 50%")).toHaveLength(2);
    expect(within(dialog).getByText("Near the stairs")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Not answered yet (2)"),
    ).toBeInTheDocument();
    // Someone the roster can't name is a current member here (only current
    // readers haven't answered), so they get the shared fallback label.
    expect(
      within(dialog).getByText(
        `Cy Diaz, ${memberFallbackLabel("unnamed-member")}`,
      ),
    ).toBeInTheDocument();
    // Individual: each responder as chat names them everywhere else.
    await user.click(within(dialog).getByRole("tab", { name: "Individual" }));
    expect(within(dialog).getByText("Ann Lee")).toBeInTheDocument();
    expect(
      within(dialog).getByText(memberFallbackLabel("gone-member-id")),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText("No answer").length).toBeGreaterThan(0);
  });

  it("exports one row per response, named as on screen", async () => {
    routeGets();
    exported.calls = [];
    const user = userEvent.setup();
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u9" isConfirmed />,
    );
    await user.click(screen.getByRole("button", { name: "Responses" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("3 responses");
    await user.click(within(dialog).getByRole("button", { name: /Export/ }));
    await user.click(await screen.findByRole("menuitem", { name: /CSV/ }));
    expect(exported.calls).toHaveLength(1);
    const [rows, prefix] = exported.calls[0]! as [
      Record<string, string>[],
      string,
    ];
    expect(prefix).toBe("form-formal-housing");
    expect(rows.map((row) => row.Name)).toEqual([
      "Ann Lee",
      memberFallbackLabel("gone-member-id"),
      "Bo Park",
    ]);
    expect(rows[0]).toMatchObject({
      "1. What room do you want?": "Single",
      "2. Anything else?": "Near the stairs",
    });
  });

  it("holds Export until someone has answered", async () => {
    api.GET.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("form-responses")
          ? { data: { responses: [], not_responded: ["u1"] } }
          : { data: { response: null } },
      ),
    );
    const user = userEvent.setup();
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u9" isConfirmed />,
    );
    await user.click(screen.getByRole("button", { name: "Responses" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("0 responses");
    expect(
      within(dialog).getByRole("button", { name: /Export/ }),
    ).toBeDisabled();
  });

  it("reads the responses again on every open", async () => {
    routeGets();
    const user = userEvent.setup();
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u9" isConfirmed />,
    );
    const reads = () =>
      api.GET.mock.calls.filter(([path]) =>
        String(path).endsWith("form-responses"),
      ).length;
    await user.click(screen.getByRole("button", { name: "Responses" }));
    await within(await screen.findByRole("dialog")).findByText("3 responses");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Responses" }));
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("stays open when the timeline unmounts the card", async () => {
    routeGets();
    const user = userEvent.setup();
    const { rerender } = wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u9" isConfirmed />,
    );
    await user.click(screen.getByRole("button", { name: "Responses" }));
    await within(await screen.findByRole("dialog")).findByText("3 responses");
    // A virtualized row scrolled out of the window.
    rerender(null);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("3 responses")).toBeInTheDocument();
  });

  it("holds Responses until the server has the card", () => {
    routeGets();
    wrap(
      <FormCard
        nameFor={nameFor}
        message={form()}
        viewerId="u9"
        isConfirmed={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Responses" })).toBeDisabled();
  });

  it("says why when the responses can't be read", async () => {
    api.GET.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("form-responses")
          ? {
              error: {
                message:
                  "Only the member who posted this form can see its responses",
              },
            }
          : { data: { response: null } },
      ),
    );
    const user = userEvent.setup();
    wrap(
      <FormCard nameFor={nameFor} message={form()} viewerId="u9" isConfirmed />,
    );
    await user.click(screen.getByRole("button", { name: "Responses" }));
    expect(
      await screen.findByText(
        "Only the member who posted this form can see its responses",
      ),
    ).toBeInTheDocument();
  });
});

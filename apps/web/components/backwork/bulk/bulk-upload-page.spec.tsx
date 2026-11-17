import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem, QueueSnapshot } from "@/lib/bulk-upload/queue";
import type { Prepared, Submission } from "@/lib/backwork-bulk/session";

/**
 * "Save all the rest" (#5252): the page sends every document left in the
 * queue with its suggested boxes, marked as waiting for its page check. The
 * queue, the suggestion search and the editor are stand-ins; what is under
 * test is what the page submits.
 */
const BOX = { x: 10, y: 10, width: 120, height: 20 };

type Item = QueueItem<Prepared, Submission>;

const fake = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    items: [] as Item[],
    snapshot: { items: [], currentId: null } as QueueSnapshot<Prepared, Submission>,
    submitted: [] as Array<{ id: string; submission: Submission }>,
  };
  const publish = () => {
    const current = state.items.find((it) => ["queued", "preparing", "ready", "failed"].includes(it.status));
    state.snapshot = { items: state.items, currentId: current?.id ?? null };
    for (const listener of listeners) listener();
  };
  const queue = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state.snapshot,
    open: vi.fn(),
    close: vi.fn(),
    pendingUploads: () => 0,
    add: vi.fn(),
    retry: vi.fn(),
    clearDone: vi.fn(),
    remove: vi.fn((id: string) => {
      state.items = state.items.filter((it) => it.id !== id);
      publish();
    }),
    submit: vi.fn((id: string, submission: Submission) => {
      state.submitted.push({ id, submission });
      state.items = state.items.map((it) =>
        it.id === id ? { ...it, status: "waiting" as const, submission } : it,
      );
      publish();
    }),
  };
  return { state, queue, publish };
});

vi.mock("@/lib/backwork-bulk/session", () => ({
  getBulkSession: () => ({
    queue: fake.queue,
    bind: vi.fn(),
    setOnScreen: vi.fn(),
    ended: () => false,
  }),
}));
vi.mock("./use-suggested-boxes", () => ({
  useSuggestedBoxes: (item: Item | null) =>
    item?.prepared ? { id: item.id, boxes: { 1: [BOX] }, textLength: 500 } : null,
}));
vi.mock("./drafts-review", () => ({ DraftsReview: () => null }));
vi.mock("./pdf-redactor", () => ({ PdfRedactor: () => <div>Editor</div> }));
vi.mock("./bulk-fields", () => ({
  BulkFieldsForm: ({
    value,
    onChange,
    disabled,
  }: {
    value: { course_number: string };
    onChange: (next: object) => void;
    disabled?: boolean;
  }) => (
    <input
      aria-label="Course"
      value={value.course_number}
      disabled={disabled}
      onChange={(event) => onChange({ ...value, course_number: event.target.value })}
    />
  ),
}));
vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/shared/subscription-gate", () => ({
  SubscriptionNotice: () => null,
  useSubscriptionGate: () => ({
    allowed: true,
    controlProps: (disabled?: boolean) => ({ disabled: !!disabled }),
  }),
}));
vi.mock("@/components/shared/bulk-drop-zone", () => ({ BulkDropZone: () => null }));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (select: (s: { activeChapterId: string }) => unknown) => select({ activeChapterId: "c1" }),
}));
vi.mock("@/lib/auth/use-auth-user-id", () => ({ useAuthUserId: () => "u1" }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useConfirmBackworkUpload: () => ({}),
  useRequestBackworkUploadUrl: () => ({}),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { BulkUploadPage } from "./bulk-upload-page";

function item(id: string, status: Item["status"] = "ready"): Item {
  return {
    id,
    file: new File(["%PDF"], `${id}.pdf`, { type: "application/pdf" }),
    status,
    prepared: status === "ready" ? ({ pageCount: 1 } as unknown as Prepared) : undefined,
  };
}

/** Background work landing: a queued document finishes loading. */
function load(id: string) {
  act(() => {
    fake.state.items = fake.state.items.map((it) => (it.id === id ? item(id) : it));
    fake.publish();
  });
}

describe("Save all the rest (#5252)", () => {
  beforeEach(() => {
    fake.state.submitted = [];
    fake.state.items = [item("a"), item("b"), item("c", "queued")];
    fake.publish();
    fake.queue.submit.mockClear();
  });

  it("saves this and every later document with its found boxes, each waiting for its check", () => {
    render(<BulkUploadPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "Course" }), { target: { value: "1010" } });
    fireEvent.click(screen.getByRole("button", { name: /Save all the rest/ }));

    // The two loaded ones go at once; the third when it has loaded.
    expect(fake.state.submitted.map((s) => s.id)).toEqual(["a", "b"]);
    expect(screen.getByText(/Saving the rest: 1 left/)).toBeInTheDocument();
    load("c");
    expect(fake.state.submitted.map((s) => s.id)).toEqual(["a", "b", "c"]);

    for (const { submission } of fake.state.submitted) {
      expect(submission).toMatchObject({ unchecked: true, boxes: { 1: [BOX] }, flatten: true });
      // What was typed for the first carries to the rest.
      expect(submission.fields.course_number).toBe("1010");
    }
    expect(fake.state.submitted.map((s) => s.submission.fields.title)).toEqual(["a", "b", "c"]);
  });

  it("saves by hand as checked, as before", () => {
    render(<BulkUploadPage />);
    fireEvent.click(screen.getByRole("button", { name: /Save and next/ }));
    expect(fake.state.submitted).toHaveLength(1);
    expect(fake.state.submitted[0]!.submission.unchecked).toBeUndefined();
  });

  it("stops at a document that couldn't be opened, and goes on once it is skipped", () => {
    fake.state.items = [item("a"), { ...item("bad", "failed"), error: "This PDF couldn't be opened." }, item("c")];
    fake.publish();
    render(<BulkUploadPage />);
    fireEvent.click(screen.getByRole("button", { name: /Save all the rest/ }));

    expect(fake.state.submitted.map((s) => s.id)).toEqual(["a"]);
    expect(screen.getByText(/Stopped at bad\.pdf/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip it and go on" }));
    expect(fake.state.submitted.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("goes back to one at a time on Stop", () => {
    fake.state.items = [item("a"), item("b", "queued")];
    fake.publish();
    render(<BulkUploadPage />);
    fireEvent.click(screen.getByRole("button", { name: /Save all the rest/ }));
    fireEvent.click(screen.getByRole("button", { name: "Stop and open them one by one" }));
    load("b");
    expect(fake.state.submitted.map((s) => s.id)).toEqual(["a"]);
    expect(screen.getByText("Editor")).toBeInTheDocument();
  });
});

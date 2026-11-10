import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClasses = vi.fn();
const mockAssign = vi.fn();
const mockToast = vi.fn();
const words = vi.hoisted(() => ({
  current: undefined as { vocabulary: Record<string, string> } | undefined,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  usePledgeClasses: (options?: { enabled?: boolean }) => mockClasses(options),
  useAssignPledgeClasses: () => ({ mutateAsync: mockAssign, isPending: false }),
}));

vi.mock("@/lib/hooks/use-chapter-vocabulary", () => ({
  useChapterVocabulary: () => words.current,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { MemberPledgeClassSection } from "./member-pledge-class-section";

const CLASSES = [
  { id: "alpha", name: "Alpha" },
  { id: "beta", name: "Beta" },
];

function renderSection(
  over: Partial<Parameters<typeof MemberPledgeClassSection>[0]> = {},
) {
  return render(
    <MemberPledgeClassSection
      open
      memberId="m1"
      displayName="Ada"
      pledgeClassId="alpha"
      orderNumber={4}
      canEdit={false}
      {...over}
    />,
  );
}

describe("MemberPledgeClassSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    words.current = undefined;
    mockClasses.mockReturnValue({
      data: CLASSES,
      isPending: false,
      isSuccess: true,
      isError: false,
    });
    mockAssign.mockResolvedValue(undefined);
  });

  it("shows a member's class and number to anyone", () => {
    renderSection();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Fraternal order")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Pledge class · Fraternal order" }),
    ).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });

  it("names both in the chapter's own words", () => {
    words.current = { vocabulary: { class: "Line", order: "Line number" } };
    renderSection();
    expect(
      screen.getByRole("heading", { name: "Line · Line number" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Line", { exact: true })).toHaveLength(1);
  });

  it("draws nothing for a member with neither, and does not read the list", () => {
    const { container } = renderSection({
      pledgeClassId: null,
      orderNumber: null,
    });
    expect(container).toBeEmptyDOMElement();
    expect(mockClasses).toHaveBeenCalledWith({ enabled: false });
  });

  it("shows only the number for a chapter that keeps a number alone", () => {
    renderSection({ pledgeClassId: null });
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByText("Not set")).toBeNull();
  });

  it("gives an officer the section with Edit even when nothing is set", () => {
    renderSection({ pledgeClassId: null, orderNumber: null, canEdit: true });
    expect(screen.getAllByText("Not set")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Edit Ada's Pledge class" }),
    ).toBeInTheDocument();
  });

  it("saves a changed number with the member's class", async () => {
    renderSection({ canEdit: true });
    await userEvent.click(
      screen.getByRole("button", { name: "Edit Ada's Pledge class" }),
    );
    const field = screen.getByLabelText("Fraternal order");
    await userEvent.clear(field);
    await userEvent.type(field, "9");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockAssign).toHaveBeenCalledWith([
      { member_id: "m1", pledge_class_id: "alpha", order_number: 9 },
    ]);
  });

  it("clears the number when the field is emptied", async () => {
    renderSection({ canEdit: true });
    await userEvent.click(
      screen.getByRole("button", { name: "Edit Ada's Pledge class" }),
    );
    await userEvent.clear(screen.getByLabelText("Fraternal order"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockAssign).toHaveBeenCalledWith([
      { member_id: "m1", pledge_class_id: "alpha", order_number: null },
    ]);
  });

  it("sets a number alone for a chapter that keeps no classes", async () => {
    renderSection({ pledgeClassId: null, orderNumber: null, canEdit: true });
    await userEvent.click(
      screen.getByRole("button", { name: "Edit Ada's Pledge class" }),
    );
    await userEvent.type(screen.getByLabelText("Fraternal order"), "12");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    // "None" in the picker is `null` on the wire, never the picker's own value.
    expect(mockAssign).toHaveBeenCalledWith([
      { member_id: "m1", pledge_class_id: null, order_number: 12 },
    ]);
  });

  it("uses a chapter word as typed, never lowercased or pluralized", () => {
    words.current = { vocabulary: { class: "PC", order: "ID number" } };
    renderSection({ canEdit: true });
    expect(
      screen.getByRole("heading", { name: "PC · ID number" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Ada's PC" }),
    ).toBeInTheDocument();
  });

  it("refuses a number that is not a whole number from 1", async () => {
    renderSection({ canEdit: true });
    await userEvent.click(
      screen.getByRole("button", { name: "Edit Ada's Pledge class" }),
    );
    const field = screen.getByLabelText("Fraternal order");
    await userEvent.clear(field);
    await userEvent.type(field, "1.5");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("points an officer at Settings when the chapter has no classes", async () => {
    mockClasses.mockReturnValue({
      data: [],
      isPending: false,
      isSuccess: true,
      isError: false,
    });
    renderSection({ pledgeClassId: null, orderNumber: null, canEdit: true });
    await userEvent.click(
      screen.getByRole("button", { name: "Edit Ada's Pledge class" }),
    );
    expect(
      screen.getByRole("link", { name: "Add to it in Settings" }),
    ).toHaveAttribute("href", "/settings?tab=classes");
  });

  it("drops an unsaved edit when the sheet closes", async () => {
    const view = renderSection({ canEdit: true });
    await userEvent.click(
      screen.getByRole("button", { name: "Edit Ada's Pledge class" }),
    );
    view.rerender(
      <MemberPledgeClassSection
        open={false}
        memberId="m1"
        displayName="Ada"
        pledgeClassId="alpha"
        orderNumber={4}
        canEdit
      />,
    );
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

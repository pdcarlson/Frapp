import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChapterCustomField } from "@repo/validation";
import {
  expectClearingEntriesEmpty,
  expectRefusedEntriesKeep,
} from "@/tests/numeric-input";

// Mock the data hooks so the tab renders without a query client / network.
const mockUseCustomFields = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockToast = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCustomFields: () => mockUseCustomFields(),
  useCreateCustomField: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateCustomField: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeleteCustomField: () => ({ mutateAsync: mockDelete, isPending: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { SettingsFieldsTab } from "./settings-fields-tab";

function customField(
  over: Partial<ChapterCustomField> = {},
): ChapterCustomField {
  return {
    id: "f1",
    chapter_id: "c1",
    key: "major",
    label: "Major",
    type: "text",
    required: false,
    visibility: "chapter",
    sensitive: false,
    options: null,
    sort: 0,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("SettingsFieldsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCustomFields.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    });
  });

  it("shows the empty state when the chapter has no fields", () => {
    render(<SettingsFieldsTab canManage />);
    expect(screen.getByText(/no custom fields yet/i)).toBeInTheDocument();
  });

  it("lists existing fields and renders a select field's choices", () => {
    mockUseCustomFields.mockReturnValue({
      data: [
        customField({ id: "f1", key: "major", label: "Major" }),
        customField({
          id: "f2",
          key: "shirt",
          label: "Shirt size",
          type: "select",
          options: { choices: ["S", "M", "L"] },
        }),
      ],
      isPending: false,
      isError: false,
    });
    render(<SettingsFieldsTab canManage />);

    expect(screen.getByText("Major")).toBeInTheDocument();
    expect(screen.getByText("Shirt size")).toBeInTheDocument();
    // Select options surface as badges.
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
  });

  it("toggling 'required' on an existing field patches it", async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({});
    mockUseCustomFields.mockReturnValue({
      data: [customField({ label: "Major", required: false })],
      isPending: false,
      isError: false,
    });
    render(<SettingsFieldsTab canManage />);

    await user.click(screen.getByRole("switch", { name: /major required/i }));
    expect(mockUpdate).toHaveBeenCalledWith({
      id: "f1",
      body: { required: true },
    });
  });

  it("creates a text field with the drafted key, label, and max length", async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({});
    render(<SettingsFieldsTab canManage />);

    await user.type(screen.getByLabelText("Key"), "graduation_year");
    await user.type(screen.getByLabelText("Label"), "Graduation year");
    // Default type is text → the max-length input is shown.
    await user.type(screen.getByLabelText(/max length/i), "4");
    await user.click(screen.getByRole("button", { name: /add field/i }));

    expect(mockCreate).toHaveBeenCalledWith({
      key: "graduation_year",
      label: "Graduation year",
      type: "text",
      required: false,
      sensitive: false,
      visibility: "chapter",
      options: { max_length: 4 },
    });
  });

  it("disables editing controls when the caller cannot manage", () => {
    render(<SettingsFieldsTab canManage={false} />);
    expect(screen.getByLabelText("Key")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /add field/i }),
    ).toBeDisabled();
  });
});

describe("SettingsFieldsTab max length guard (#2206)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCustomFields.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    });
    mockCreate.mockResolvedValue({});
  });

  const maxLength = () => screen.getByLabelText(/max length/i);

  function draftField() {
    render(<SettingsFieldsTab canManage />);
    fireEvent.change(screen.getByLabelText("Key"), {
      target: { value: "graduation_year" },
    });
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Graduation year" },
    });
  }

  const submit = () =>
    fireEvent.submit(
      screen.getByRole("button", { name: /add field/i }).closest("form")!,
    );

  it("keeps the last whole number through a negative or a decimal", () => {
    draftField();
    expectRefusedEntriesKeep(maxLength(), "120");
  });

  it("reads an emptied or unparseable field as no limit", () => {
    draftField();
    expectClearingEntriesEmpty(maxLength(), "120");
  });

  it("keeps the 0 left by deleting a leading digit, then refuses it at save", async () => {
    draftField();
    fireEvent.change(maxLength(), { target: { value: "100" } });
    fireEvent.change(maxLength(), { target: { value: "00" } });
    expect(maxLength()).toHaveValue(0);
    submit();

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Max length starts at 1" }),
      ),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates with the kept whole number", async () => {
    draftField();
    fireEvent.change(maxLength(), { target: { value: "120" } });
    fireEvent.change(maxLength(), { target: { value: "1.5" } });
    submit();
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]![0].options).toEqual({ max_length: 120 });
  });

  it("creates with no limit when the field is left empty", async () => {
    draftField();
    fireEvent.change(maxLength(), { target: { value: "" } });
    submit();
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]![0]).not.toHaveProperty("options");
  });
});

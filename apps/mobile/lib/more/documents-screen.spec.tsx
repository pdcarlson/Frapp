/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import * as WebBrowser from "expo-web-browser";
import { Alert } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingCreateButton } from "@/components/floating-create-button";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * #3399. s12 draws its floating Upload document button only for a viewer who
 * holds `chapter_docs:upload`, the permission both upload routes
 * carry, so a member never meets a control the server would refuse.
 *
 * It renders `app/(app)/documents.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

let permissions: string[] = [];
let folderRows: unknown[] = [];
let documentRows: unknown[] = [];
let chapterId: string | null = "chapter-a";
let semesterRows: unknown[] | undefined = [];
const documentsArgs: unknown[][] = [];
let names: Record<string, string> = {};
const download = vi.fn();
const deleteDocument = vi.fn(async () => undefined);
const refetchFolders = vi.fn(async () => undefined);
const refetchDocuments = vi.fn(async () => undefined);
const LOADED = {
  data: [],
  isPending: false,
  isError: false,
  isFetching: false,
};

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  usePermissionList: () => permissions,
  useDocuments: (...args: unknown[]) => {
    documentsArgs.push(args);
    return {
      ...LOADED,
      data: documentRows,
      refetch: refetchDocuments,
    };
  },
  useDocumentFolders: () => ({
    ...LOADED,
    data: folderRows,
    refetch: refetchFolders,
  }),
  useActiveChapterId: () => chapterId,
  useMemberDisplayNames: () => ({ byId: names }),
  useSemesters: () => ({ data: semesterRows }),
  useDeleteDocument: () => ({ mutateAsync: deleteDocument }),
  useDocumentDownloadUrl: () => ({ mutateAsync: download }),
  useRequestDocumentUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useConfirmDocumentUpload: () => ({ mutateAsync: vi.fn() }),
}));

// A purple stand-in, so a glyph painted house gold (`gold.askText`) fails.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#7A3FC2" }),
}));

import DocumentsScreen from "@/app/(app)/documents";
import { FilterChips } from "@/components/filter-chips";
import { ListRow } from "@/components/list-section";
import { InlineNote } from "@/components/inline-note";

const present = vi.fn();
const mounted: ReactTestRenderer[] = [];

const screen = () => (
  <FrappThemeProvider>
    <DocumentsScreen />
  </FrappThemeProvider>
);

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(screen(), {
      createNodeMock: (element) =>
        (element.type as unknown) === "BottomSheetModal"
          ? { present, dismiss: vi.fn() }
          : null,
    });
  });
  mounted.push(tree);
  return tree;
}

const uploadControls = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "Upload document",
  );

const sheets = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "BottomSheetModal");

afterEach(() => {
  permissions = [];
  folderRows = [];
  documentRows = [];
  semesterRows = [];
  names = {};
  documentsArgs.length = 0;
  deleteDocument.mockReset();
  chapterId = "chapter-a";
  present.mockReset();
  download.mockReset();
  refetchFolders.mockClear();
  refetchDocuments.mockClear();
  // Back to the suite-wide stand-in (vitest.setup.ts), a browser dismissed at
  // once, after a spec that held one open.
  vi.mocked(WebBrowser.openBrowserAsync).mockResolvedValue({
    type: "dismiss",
  } as WebBrowser.WebBrowserResult);
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

describe("Documents upload (#3399)", () => {
  it.each([
    ["chapter_docs:upload", ["members:view", "chapter_docs:upload"]],
    ["the owner's wildcard", ["*"]],
  ])(
    "draws the floating create button for %s, and it opens s21",
    (_who, held) => {
      permissions = held;
      const tree = render();

      const [upload] = uploadControls(tree);
      expect(upload).toBeDefined();
      // The screen's one create action floats bottom right, in the same spot
      // as Tasks' and Service hours', not on the back row.
      expect(
        tree.root.findAllByType(FloatingCreateButton).map((b) => b.props.label),
      ).toEqual(["Upload document"]);

      act(() => {
        upload!.props.onPress();
      });
      expect(present).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["a member", ["members:view", "backwork:upload"]],
    ["a viewer whose permissions are still loading", []],
  ])("draws no glyph and no sheet for %s", (_who, held) => {
    permissions = held;
    const tree = render();

    expect(uploadControls(tree)).toHaveLength(0);
    expect(sheets(tree)).toHaveLength(0);
  });

  it("draws the upload the sheet closed on as a quiet first row", async () => {
    permissions = ["*"];
    documentRows = [
      {
        id: "d1",
        title: "Bylaws",
        created_at: "2026-11-01T12:00:00Z",
      },
    ];
    const tree = render();
    const sheet = () =>
      tree.root.find((node) => typeof node.props.onPending === "function");

    act(() => {
      sheet().props.onPending({ title: "Look at this", failed: null });
    });
    const rows = () => tree.root.findAllByType(ListRow);
    expect(rows()[0]!.props.label).toBe("Look at this");
    expect(rows()[0]!.props.description).toBe("Uploading…");
    // No chevron and no tap while it sends: nothing to open yet.
    expect(rows()[0]!.props.onPress).toBeUndefined();
    expect(rows()[1]!.props.label).toBe("Bylaws");

    // Filed: the list re-reads, then the row gives way to the document.
    let refetched!: () => void;
    refetchDocuments.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          refetched = () => resolve(undefined);
        }),
    );
    act(() => {
      sheet().props.onUploaded("Look at this");
    });
    expect(rows()[0]!.props.label).toBe("Look at this");
    await act(async () => refetched());
    expect(rows().map((row) => row.props.label)).toEqual(["Bylaws"]);
  });

  it("says a failed upload didn't go through, and reopens the sheet on a tap", () => {
    permissions = ["*"];
    const tree = render();
    const sheet = () =>
      tree.root.find((node) => typeof node.props.onPending === "function");

    act(() => {
      sheet().props.onPending({
        title: "Look at this",
        failed: "Couldn't upload that photo. Try again in a moment.",
      });
    });
    // Drawn even in an empty library, in place of the empty state.
    expect(tree.root.findAllByType(InlineNote)).toHaveLength(0);
    const [row] = tree.root.findAllByType(ListRow);
    expect(row!.props.description).toBe("Didn't upload. Tap to try again.");
    expect(row!.props.descriptionTone).toBe("destructive");
    act(() => {
      row!.props.onPress();
    });
    expect(present).toHaveBeenCalledTimes(1);

    // Cancel in the sheet gives the upload up, and the row with it.
    act(() => {
      sheet().props.onPending(null);
    });
    expect(tree.root.findAllByType(ListRow)).toHaveLength(0);
  });

  it("opens s21 on the folder s12 is filtered to", () => {
    permissions = ["*"];
    folderRows = [
      { id: "f1", name: "Minutes", sort_order: 0 },
      { id: "f2", name: "Bylaws", sort_order: 1 },
    ];
    const tree = render();
    const uploadSheet = () =>
      tree.root.find((node) => typeof node.props.onUploaded === "function");
    expect(uploadSheet().props.initialFolder).toBeNull();

    act(() => {
      tree.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "Filter by folder" &&
            typeof node.props.onSelect === "function",
        )
        .props.onSelect("Bylaws");
    });
    expect(uploadSheet().props.initialFolder).toBe("Bylaws");
  });

  it("mounts a fresh s21 for each chapter", () => {
    // A retry s21 holds names a path minted under the chapter it was sent from.
    permissions = ["*"];
    const tree = render();
    const uploadSheet = () =>
      tree.root.find((node) => typeof node.props.onUploaded === "function");
    const first = uploadSheet();

    act(() => {
      tree.update(screen());
    });
    expect(uploadSheet()).toBe(first);

    chapterId = "chapter-b";
    act(() => {
      tree.update(screen());
    });
    expect(uploadSheet()).not.toBe(first);
  });

  it("no longer sends anyone to the web dashboard", () => {
    const tree = render();

    expect(screenText(tree)).toContain("No documents yet.");
    expect(screenText(tree)).not.toContain("web dashboard");
  });
});

/**
 * Empty-states plan rule 7 (2026-11-07): an empty library or a search miss is
 * one line where the rows would be, with the way out as its link; and opening
 * one document marks that row alone.
 */
describe("Documents states and rows", () => {
  const note = (tree: ReactTestRenderer) => tree.root.findByType(InlineNote);

  it("says the library is empty in one line, and points an uploader to +", () => {
    expect(screenText(render())).toContain("No documents yet.");
    expect(screenText(render())).not.toContain("Tap + to upload one.");

    permissions = ["chapter_docs:upload"];
    expect(screenText(render())).toContain(
      "No documents yet. Tap + to upload one.",
    );
  });

  it("names the query on a miss, and offers Search all files inside a folder", () => {
    folderRows = [{ id: "f1", name: "Bylaws", sort_order: 0 }];
    const tree = render();
    const search = () =>
      tree.root.find(
        (node) =>
          node.props.accessibilityLabel === "Search documents" &&
          typeof node.props.onChangeText === "function",
      );
    const folderChips = () =>
      tree.root.find(
        (node) =>
          node.props.accessibilityLabel === "Filter by folder" &&
          typeof node.props.onSelect === "function",
      );

    act(() => search().props.onChangeText("budget"));
    expect(screenText(tree)).toContain("No documents match “budget”.");
    expect(note(tree).props.action.label).toBe("Clear search");

    act(() => folderChips().props.onSelect("Bylaws"));
    expect(screenText(tree)).toContain("Nothing in Bylaws matches “budget”.");
    expect(note(tree).props.action.label).toBe("Search all files");

    act(() => note(tree).props.action.onPress());
    expect(folderChips().props.selected).toBeNull();
    expect(screenText(tree)).toContain("No documents match “budget”.");

    act(() => note(tree).props.action.onPress());
    expect(screenText(tree)).toContain("No documents yet.");
  });

  it("marks only the opening row busy, and greys out none", async () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
      { id: "d2", title: "Minutes", created_at: "2026-10-01T12:00:00Z" },
    ];
    let settle!: (value: unknown) => void;
    download.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const tree = render();
    const rows = () => tree.root.findAllByType(ListRow);

    await act(async () => {
      rows()[0]!.props.onPress();
    });
    expect(rows().map((row) => row.props.busy)).toEqual([true, false]);
    expect(rows().map((row) => row.props.disabled)).toEqual([
      undefined,
      undefined,
    ]);

    await act(async () => {
      settle({ downloadUrl: "https://signed/bylaws" });
    });
    expect(rows().map((row) => row.props.busy)).toEqual([false, false]);
  });

  // A tap on another row while one is opening used to be dropped without a
  // sign. Now the latest tap wins: the spinner moves, and the first row's
  // URL, landing late, opens nothing.
  it("lets a tap on another row win while the first is still opening", async () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
      { id: "d2", title: "Minutes", created_at: "2026-10-01T12:00:00Z" },
    ];
    const settle: Record<string, (value: unknown) => void> = {};
    download.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          settle[id] = resolve;
        }),
    );
    const openBrowser = vi.mocked(WebBrowser.openBrowserAsync);
    openBrowser.mockClear();
    const tree = render();
    const rows = () => tree.root.findAllByType(ListRow);

    await act(async () => {
      rows()[0]!.props.onPress();
    });
    await act(async () => {
      rows()[1]!.props.onPress();
    });
    expect(download).toHaveBeenCalledTimes(2);
    expect(rows().map((row) => row.props.busy)).toEqual([false, true]);

    await act(async () => {
      settle.d1!({ downloadUrl: "https://signed/bylaws" });
    });
    expect(openBrowser).not.toHaveBeenCalled();
    expect(rows().map((row) => row.props.busy)).toEqual([false, true]);

    await act(async () => {
      settle.d2!({ downloadUrl: "https://signed/minutes" });
    });
    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(openBrowser).toHaveBeenCalledWith("https://signed/minutes");
    expect(rows().map((row) => row.props.busy)).toEqual([false, false]);
  });

  // The same race, settled by a failure: the first row's signed URL is
  // refused after the member has tapped another row. That row is the one the
  // member is waiting on, so the older failure says nothing, and the newer
  // row still opens.
  it("keeps an older tap's failure off the screen once another row is tapped", async () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
      { id: "d2", title: "Minutes", created_at: "2026-10-01T12:00:00Z" },
    ];
    const settle: Record<
      string,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    > = {};
    download.mockImplementation(
      (id: string) =>
        new Promise((resolve, reject) => {
          settle[id] = { resolve, reject };
        }),
    );
    const openBrowser = vi.mocked(WebBrowser.openBrowserAsync);
    openBrowser.mockClear();
    openBrowser.mockResolvedValue({
      type: "dismiss",
    } as WebBrowser.WebBrowserResult);
    const tree = render();
    const rows = () => tree.root.findAllByType(ListRow);

    await act(async () => {
      rows()[0]!.props.onPress();
    });
    await act(async () => {
      rows()[1]!.props.onPress();
    });

    await act(async () => {
      settle.d1!.reject(new Error("signed URL refused"));
    });
    expect(screenText(tree)).not.toContain("couldn't be opened");
    expect(rows().map((row) => row.props.busy)).toEqual([false, true]);

    await act(async () => {
      settle.d2!.resolve({ downloadUrl: "https://signed/minutes" });
    });
    expect(openBrowser).toHaveBeenCalledWith("https://signed/minutes");
    expect(screenText(tree)).not.toContain("couldn't be opened");
    expect(rows().map((row) => row.props.busy)).toEqual([false, false]);
  });

  // Once a document's browser is on its way up, a tap that reaches another
  // row does nothing. iOS refuses a second presentation, and that refusal
  // would show "couldn't be opened" over the document that did open.
  it("starts no second browser while the first is still being presented", async () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
      { id: "d2", title: "Minutes", created_at: "2026-10-01T12:00:00Z" },
    ];
    download.mockImplementation(async (id: string) => ({
      downloadUrl: `https://signed/${id}`,
    }));
    const openBrowser = vi.mocked(WebBrowser.openBrowserAsync);
    openBrowser.mockClear();
    let dismiss!: () => void;
    openBrowser.mockImplementation(() =>
      openBrowser.mock.calls.length === 1
        ? new Promise((resolve) => {
            dismiss = () =>
              resolve({ type: "dismiss" } as WebBrowser.WebBrowserResult);
          })
        : Promise.reject(new Error("Another web browser is already open")),
    );
    const tree = render();
    const rows = () => tree.root.findAllByType(ListRow);

    await act(async () => {
      rows()[0]!.props.onPress();
    });
    expect(openBrowser).toHaveBeenCalledTimes(1);

    await act(async () => {
      rows()[1]!.props.onPress();
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).not.toContain("couldn't be opened");
    expect(rows().map((row) => row.props.busy)).toEqual([true, false]);

    await act(async () => {
      dismiss();
    });
    expect(rows().map((row) => row.props.busy)).toEqual([false, false]);
    expect(screenText(tree)).not.toContain("couldn't be opened");
  });

  // Folder chips scroll sideways here (one row, not three), which is an
  // opt-in: FilterChips wraps by default, for the sheets.
  it("puts its folder chips on one sideways-scrolling row", () => {
    folderRows = [{ id: "f1", name: "Bylaws", sort_order: 0 }];
    const tree = render();
    const chips = tree.root.findByType(FilterChips);

    expect(chips.props.scroll).toBe(true);
    expect(
      chips.findAll((node) => (node.type as unknown) === "ScrollView"),
    ).toHaveLength(1);
  });
});

describe("Documents pull-to-refresh (#3385)", () => {
  it("refreshes the folders and the documents list on a pull (#3385)", async () => {
    const tree = render();
    const control = tree.root.find((node) => node.props.refreshControl != null)
      .props.refreshControl as React.ReactElement<{
      refresh: () => Promise<unknown>;
    }>;

    await act(async () => {
      await control.props.refresh();
    });
    expect(refetchFolders).toHaveBeenCalledWith({ cancelRefetch: true });
    expect(refetchDocuments).toHaveBeenCalledWith({ cancelRefetch: true });
  });
});

describe("Documents search, filters, sort and delete, as web's (#3938)", () => {
  const LIBRARY = [
    {
      id: "d-1",
      title: "Chapter bylaws",
      folder: "Governance",
      uploaded_by: "u-ryan",
      created_at: "2026-08-12T14:00:00.000Z",
    },
    {
      id: "d-2",
      title: "Budget FY2026",
      folder: "Finance",
      document_type: "Spreadsheet",
      uploaded_by: "u-ana",
      created_at: "2026-10-01T14:00:00.000Z",
    },
    {
      id: "d-3",
      title: "Alumni mixer flyer",
      uploaded_by: "u-ana",
      created_at: "2026-09-01T14:00:00.000Z",
    },
  ];

  const rowLabels = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(ListRow).map((row) => row.props.label as string);
  const byLabel = (tree: ReactTestRenderer, label: string) =>
    tree.root.find(
      (node) =>
        node.props.accessibilityLabel === label &&
        typeof (
          node.props.onSelect ??
          node.props.onChangeText ??
          node.props.onPress
        ) === "function",
    );
  const openPanel = (tree: ReactTestRenderer) =>
    act(() => byLabel(tree, "Sort and filter").props.onPress());

  function loaded() {
    documentRows = LIBRARY;
    names = { "u-ryan": "Ryan Castellano", "u-ana": "Ana Ruiz" };
    return render();
  }

  it("reads the whole library once and orders it Name A–Z, as web does", () => {
    const tree = loaded();
    expect(rowLabels(tree)).toEqual([
      "Alumni mixer flyer",
      "Budget FY2026",
      "Chapter bylaws",
    ]);
    // The whole library, unnarrowed on the wire: no `search`, no `folder`.
    expect(documentsArgs.length).toBeGreaterThan(0);
    expect(documentsArgs.every((args) => args.length === 0)).toBe(true);
    act(() => byLabel(tree, "Search documents").props.onChangeText("budget"));
    expect(documentsArgs.every((args) => args.length === 0)).toBe(true);
    act(() => byLabel(tree, "Search documents").props.onChangeText(""));
    expect(screenText(tree)).toContain(
      "Uploaded Oct 1 by Ana Ruiz · Finance · Spreadsheet",
    );
  });

  it("forgives a typo and searches the uploader's name, on the device", () => {
    const tree = loaded();
    act(() => byLabel(tree, "Search documents").props.onChangeText("bylaw"));
    expect(rowLabels(tree)).toEqual(["Chapter bylaws"]);

    act(() => byLabel(tree, "Search documents").props.onChangeText("budgte"));
    expect(rowLabels(tree)).toEqual(["Budget FY2026"]);

    act(() => byLabel(tree, "Search documents").props.onChangeText("ana"));
    expect(rowLabels(tree)).toEqual(["Alumni mixer flyer", "Budget FY2026"]);
  });

  it("sorts and filters from the Sort & filter panel, and counts what is set", () => {
    const tree = loaded();
    openPanel(tree);

    act(() => byLabel(tree, "Sort documents").props.onSelect("newest"));
    expect(rowLabels(tree)).toEqual([
      "Budget FY2026",
      "Alumni mixer flyer",
      "Chapter bylaws",
    ]);

    act(() => byLabel(tree, "Filter by uploader").props.onSelect("u-ryan"));
    expect(rowLabels(tree)).toEqual(["Chapter bylaws"]);
    expect(byLabel(tree, "Sort and filter, 2 set")).toBeDefined();
  });

  it("filters by file type, from the declared type or the stored name", () => {
    documentRows = [
      { ...LIBRARY[0], content_type: "application/pdf" },
      {
        ...LIBRARY[1],
        content_type: null,
        storage_path: "chapters/c/documents/x/budget.xlsx",
      },
      LIBRARY[2],
    ];
    names = { "u-ryan": "Ryan Castellano", "u-ana": "Ana Ruiz" };
    const tree = render();
    openPanel(tree);
    const types = byLabel(tree, "Filter by file type");
    expect(
      (types.props.chips as { label: string }[]).map((chip) => chip.label),
    ).toEqual(["Any type", "PDF", "Spreadsheet", "Other"]);

    act(() => types.props.onSelect("spreadsheet"));
    expect(rowLabels(tree)).toEqual(["Budget FY2026"]);
    expect(byLabel(tree, "Sort and filter, 1 set")).toBeDefined();

    act(() => byLabel(tree, "Filter by file type").props.onSelect(null));
    act(() => byLabel(tree, "Search documents").props.onChangeText("pdf"));
    expect(rowLabels(tree)).toEqual(["Chapter bylaws"]);
  });

  it("offers This semester only once the archives have loaded", () => {
    semesterRows = undefined;
    const tree = loaded();
    openPanel(tree);
    const dateLabels = () =>
      (
        byLabel(tree, "Filter by date added").props.chips as { label: string }[]
      ).map((chip) => chip.label);
    expect(dateLabels()).toEqual(["Any time", "Last 30 days"]);

    semesterRows = [
      { end_date: "2026-08-31", created_at: "2026-09-01T00:00:00Z" },
    ];
    const later = loaded();
    act(() => byLabel(later, "Sort and filter").props.onPress());
    act(() =>
      byLabel(later, "Filter by date added").props.onSelect("semester"),
    );
    expect(rowLabels(later)).toEqual(["Alumni mixer flyer", "Budget FY2026"]);
  });

  it("says a filter matched nothing and clears it", () => {
    const tree = loaded();
    openPanel(tree);
    act(() => byLabel(tree, "Filter by uploader").props.onSelect("u-ryan"));
    act(() => byLabel(tree, "Search documents").props.onChangeText("budget"));
    const note = tree.root.findByType(InlineNote);
    expect(screenText(tree)).toContain("No documents match “budget”.");
    expect(note.props.action.label).toBe("Clear filters");
    act(() => note.props.action.onPress());
    expect(rowLabels(tree)).toHaveLength(3);
  });

  it("says when the library hit the 1,000-row cap", () => {
    documentRows = Array.from({ length: 1000 }, (_, index) => ({
      id: `d-${index}`,
      title: `File ${index}`,
      created_at: "2026-08-12T14:00:00.000Z",
    }));
    expect(screenText(render())).toContain(
      "Showing the newest 1,000 documents.",
    );
  });

  it("deletes on a long press, after a confirm, for chapter_docs:manage only", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const member = loaded();
    expect(
      member.root.findAllByType(ListRow).every((row) => !row.props.onLongPress),
    ).toBe(true);

    permissions = ["chapter_docs:manage"];
    const officer = loaded();
    const bylaws = () =>
      officer.root
        .findAllByType(ListRow)
        .find((row) => row.props.label === "Chapter bylaws")!;
    expect(bylaws().props.longPressLabel).toBe("Delete document");

    act(() => bylaws().props.onLongPress());
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alert.mock.calls[0]!;
    expect(title).toBe("Delete Chapter bylaws?");
    expect(deleteDocument).not.toHaveBeenCalled();

    let finish!: () => void;
    deleteDocument.mockImplementation(
      () =>
        new Promise<undefined>(
          (resolve) => (finish = () => resolve(undefined)),
        ),
    );
    const confirm = buttons!.find((button) => button.style === "destructive")!;
    act(() => confirm.onPress!());
    expect(deleteDocument).toHaveBeenCalledWith("d-1");
    expect(bylaws().props.busy).toBe(true);
    await act(async () => finish());
    // Gone at once, not left pressable until the library re-reads.
    expect(rowLabels(officer)).not.toContain("Chapter bylaws");
    alert.mockRestore();
  });

  it("says so when a delete fails", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
    permissions = ["chapter_docs:manage"];
    deleteDocument.mockRejectedValue(new Error("nope"));
    const tree = loaded();
    act(() =>
      tree.root
        .findAllByType(ListRow)
        .find((row) => row.props.label === "Budget FY2026")!
        .props.onLongPress(),
    );
    const buttons = alert.mock.calls[0]![2]!;
    await act(async () => {
      buttons.find((button) => button.style === "destructive")!.onPress!();
    });
    expect(screenText(tree)).toContain(
      "Couldn't delete “Budget FY2026”. Try again in a moment.",
    );
    alert.mockRestore();
  });
});

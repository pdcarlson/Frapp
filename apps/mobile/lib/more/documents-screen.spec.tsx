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
let starRows: { folder_ids: string[]; document_ids: string[] } = {
  folder_ids: [],
  document_ids: [],
};
const setStar = vi.fn(async () => undefined);
let starsFailed = false;
const setPin = vi.fn(async () => undefined);
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
  useDocumentStars: () => ({
    ...LOADED,
    data: starsFailed ? undefined : starRows,
    isError: starsFailed,
    refetch: vi.fn(),
  }),
  useSetDocumentStar: () => ({ mutateAsync: setStar }),
  useSetDocumentPin: () => ({ mutateAsync: setPin, isPending: false }),
}));

// A purple stand-in, so a glyph painted house gold (`gold.askText`) fails.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#7A3FC2",
    accentPrimary: "#7A3FC2",
    accentOnPrimary: "#FFFFFF",
  }),
}));

import DocumentsScreen from "@/app/(app)/documents";
import { FilterChips } from "@/components/filter-chips";
import { ListRow, PressableRow } from "@/components/list-section";
import { InlineNote } from "@/components/inline-note";
import { UploadDocumentSheet } from "@/components/documents/upload-document-sheet";
import { DocumentActionsSheet } from "@/components/documents/document-actions-sheet";
import { MarkedCards } from "@/components/documents/marked-cards";
import { DocumentTiles } from "@/components/documents/document-tiles";
import { PinGlyph, StarGlyph } from "@/components/documents/document-glyphs";
import { ListLayoutToggle } from "@/components/list-layout-toggle";
import { resetListLayoutsForTests, setListLayout } from "@/lib/list-layout";

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

// The upload sheet (s21); the Star and Pin sheet is always mounted (#3934).
const sheets = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(UploadDocumentSheet);

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
  starRows = { folder_ids: [], document_ids: [] };
  setStar.mockReset();
  starsFailed = false;
  setPin.mockReset();
  resetListLayoutsForTests();
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

  it("deletes from the long-press sheet, after a confirm, for chapter_docs:manage only", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const member = loaded();
    // A member's long press opens Star only (#3934): no Delete in the sheet.
    expect(member.root.findByType(DocumentActionsSheet).props.canManage).toBe(
      false,
    );

    permissions = ["chapter_docs:manage"];
    const officer = loaded();
    const bylaws = () =>
      officer.root
        .findAllByType(ListRow)
        .find((row) => row.props.label === "Chapter bylaws")!;
    expect(bylaws().props.longPressLabel).toBe("Star, pin or delete");

    act(() => bylaws().props.onLongPress());
    const sheet = officer.root.findByType(DocumentActionsSheet);
    expect(sheet.props.target).toMatchObject({
      kind: "document",
      id: "d-1",
      name: "Chapter bylaws",
    });
    act(() => sheet.props.onDelete(sheet.props.target));
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
    const sheet = tree.root.findByType(DocumentActionsSheet);
    act(() => sheet.props.onDelete(sheet.props.target));
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

describe("Documents pinned and starred (#3934)", () => {
  const LIBRARY = [
    {
      id: "d-1",
      title: "Chapter bylaws",
      folder: "Governance",
      created_at: "2026-08-12T14:00:00.000Z",
      pinned_at: "2026-11-11T00:00:00.000Z",
    },
    {
      id: "d-2",
      title: "Budget FY2026",
      folder: "Finance",
      created_at: "2026-10-01T14:00:00.000Z",
    },
    {
      id: "d-3",
      title: "Alumni mixer flyer",
      created_at: "2026-09-01T14:00:00.000Z",
    },
  ];
  const FOLDERS = [
    { id: "f-1", name: "Finance", sort_order: 0 },
    { id: "f-2", name: "Governance", sort_order: 1 },
    {
      id: "f-3",
      name: "Rush",
      sort_order: 2,
      pinned_at: "2026-11-11T00:00:00.000Z",
    },
  ];

  function loaded() {
    documentRows = LIBRARY;
    folderRows = FOLDERS;
    starRows = { folder_ids: ["f-2"], document_ids: ["d-2"] };
    return render();
  }

  const folderChips = (tree: ReactTestRenderer) =>
    tree.root
      .findAllByType(FilterChips)
      .find((chips) => chips.props.accessibilityLabel === "Filter by folder")!;
  const rowLabels = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(ListRow).map((row) => row.props.label as string);

  it("orders the folder chips pinned, then starred, then the rest, each marked", () => {
    const chips = folderChips(loaded()).props.chips as {
      label: string;
      mark?: unknown;
    }[];
    expect(chips.map((chip) => chip.label)).toEqual([
      "All",
      "Rush",
      "Governance",
      "Finance",
    ]);
    expect(chips.map((chip) => !!chip.mark)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("draws PINNED and STARRED cards above All, folders and files together", () => {
    const tree = loaded();
    const cards = tree.root.findByType(MarkedCards);
    const names = (
      items: {
        kind: string;
        folder?: { name: string };
        doc?: { title: string };
      }[],
    ) =>
      items.map((item) =>
        item.kind === "folder" ? item.folder!.name : item.doc!.title,
      );
    expect(names(cards.props.pinned)).toEqual(["Rush", "Chapter bylaws"]);
    expect(names(cards.props.starred)).toEqual(["Governance", "Budget FY2026"]);
    expect(screenText(tree)).toContain("Pinned");
    expect(screenText(tree)).toContain("Folder · 0 files");
    // The list below keeps its own order on All.
    expect(rowLabels(tree)).toEqual([
      "Alumni mixer flyer",
      "Budget FY2026",
      "Chapter bylaws",
    ]);
  });

  it("filters to Pinned, Starred or either from the panel, with the search (#4290)", () => {
    const tree = loaded();
    const press = (label: string) =>
      act(() =>
        tree.root
          .find(
            (node) =>
              node.props.accessibilityLabel === label &&
              typeof node.props.onPress === "function",
          )
          .props.onPress(),
      );
    const toggle = (label: string) =>
      tree.root.find(
        (node) =>
          node.props.accessibilityRole === "togglebutton" &&
          node.props.label === label,
      );
    press("Sort and filter");
    expect(toggle("Starred").props.accessibilityState).toEqual({ checked: false });

    act(() => toggle("Starred").props.onPress());
    expect(toggle("Starred").props.accessibilityState).toEqual({ checked: true });
    // Any filter swaps the cards for the list, the tiers leading it.
    expect(tree.root.findAllByType(MarkedCards)).toHaveLength(0);
    expect(rowLabels(tree)).toEqual(["Budget FY2026"]);
    // It counts as one filter on the Sort & filter chip.
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Sort and filter, 1 set",
      ).length,
    ).toBeGreaterThan(0);

    act(() => toggle("Pinned").props.onPress());
    expect(rowLabels(tree)).toEqual(["Chapter bylaws", "Budget FY2026"]);
    // Each toggle is one filter on the chip.
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Sort and filter, 2 set",
      ).length,
    ).toBeGreaterThan(0);

    act(() => toggle("Starred").props.onPress());
    expect(rowLabels(tree)).toEqual(["Chapter bylaws"]);

    // With the search: nothing pinned matches "budget".
    act(() =>
      tree.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "Search documents" &&
            typeof node.props.onChangeText === "function",
        )
        .props.onChangeText("budget"),
    );
    expect(rowLabels(tree)).toEqual([]);
    // The way out names what it clears: the search and the Pinned filter.
    const clear = tree.root.find(
      (node) =>
        node.props.action?.label === "Clear filters" &&
        typeof node.props.action?.onPress === "function",
    );
    act(() => clear.props.action.onPress());
    expect(toggle("Pinned").props.accessibilityState).toEqual({ checked: false });
    expect(rowLabels(tree)).toEqual([
      "Alumni mixer flyer",
      "Budget FY2026",
      "Chapter bylaws",
    ]);
  });

  it("keeps a file unstarred from the sheet under Starred until the filter changes (#4290)", async () => {
    const tree = loaded();
    act(() =>
      tree.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "Sort and filter" &&
            typeof node.props.onPress === "function",
        )
        .props.onPress(),
    );
    const starredToggle = () =>
      tree.root.find(
        (node) =>
          node.props.accessibilityRole === "togglebutton" &&
          node.props.label === "Starred",
      );
    act(() => starredToggle().props.onPress());
    expect(rowLabels(tree)).toEqual(["Budget FY2026"]);

    const row = tree.root
      .findAllByType(ListRow)
      .find((r) => r.props.label === "Budget FY2026")!;
    act(() => row.props.onLongPress());
    starRows = { folder_ids: ["f-2"], document_ids: [] };
    const sheet = () => tree.root.findByType(DocumentActionsSheet);
    await act(async () => sheet().props.onToggleStar(sheet().props.target));
    act(() => tree.update(screen()));
    expect(rowLabels(tree)).toEqual(["Budget FY2026"]);

    act(() => starredToggle().props.onPress());
    act(() => starredToggle().props.onPress());
    expect(rowLabels(tree)).toEqual([]);
  });

  it("leads a folder's or a search's list with pinned, then starred files, instead of cards", () => {
    documentRows = [
      ...LIBRARY,
      {
        id: "d-4",
        title: "Chapter budget",
        created_at: "2026-09-02T14:00:00.000Z",
      },
    ];
    folderRows = FOLDERS;
    starRows = { folder_ids: ["f-2"], document_ids: ["d-2"] };
    const tree = render();
    act(() => tree.root.findByType(MarkedCards).props.onOpenFolder("Finance"));
    expect(tree.root.findAllByType(MarkedCards)).toHaveLength(0);
    expect(rowLabels(tree)).toEqual(["Budget FY2026"]);

    act(() => folderChips(tree).props.onSelect(null));
    act(() =>
      tree.root
        .findAll(
          (node) =>
            node.props.accessibilityLabel === "Search documents" &&
            typeof node.props.onChangeText === "function",
        )[0]!
        .props.onChangeText("chapter"),
    );
    expect(tree.root.findAllByType(MarkedCards)).toHaveLength(0);
    // Name A–Z would put "Chapter budget" first; the pin leads instead.
    expect(rowLabels(tree)).toEqual(["Chapter bylaws", "Chapter budget"]);
  });

  it("opens the Star and Pin sheet from a folder chip's long press", () => {
    permissions = ["chapter_docs:manage"];
    const tree = loaded();
    const rush = (
      folderChips(tree).props.chips as {
        label: string;
        onLongPress?: () => void;
      }[]
    ).find((chip) => chip.label === "Rush")!;
    act(() => rush.onLongPress!());
    expect(present).toHaveBeenCalled();
    const sheet = tree.root.findByType(DocumentActionsSheet);
    expect(sheet.props.target).toEqual({
      kind: "folder",
      id: "f-3",
      name: "Rush",
      pinned: true,
      starred: false,
    });
    expect(sheet.props.canManage).toBe(true);
  });

  it("stars and pins from the sheet", async () => {
    permissions = ["chapter_docs:manage"];
    const tree = loaded();
    const sheet = () => tree.root.findByType(DocumentActionsSheet);
    act(() =>
      tree.root
        .findAllByType(ListRow)
        .find((row) => row.props.label === "Alumni mixer flyer")!
        .props.onLongPress(),
    );
    await act(async () => sheet().props.onToggleStar(sheet().props.target));
    expect(setStar).toHaveBeenCalledWith({
      target: { kind: "document", id: "d-3" },
      starred: true,
    });

    await act(async () => sheet().props.onTogglePin(sheet().props.target));
    expect(setPin).toHaveBeenCalledWith({
      target: { kind: "document", id: "d-3" },
      pinned: true,
    });
  });

  it("says so when a star or a pin fails", async () => {
    permissions = ["chapter_docs:manage"];
    const tree = loaded();
    const sheet = () => tree.root.findByType(DocumentActionsSheet);
    act(() =>
      tree.root
        .findAllByType(ListRow)
        .find((row) => row.props.label === "Alumni mixer flyer")!
        .props.onLongPress(),
    );
    setStar.mockRejectedValueOnce(new Error("nope"));
    await act(async () => sheet().props.onToggleStar(sheet().props.target));
    expect(screenText(tree)).toContain(
      "Couldn't star “Alumni mixer flyer”. Try again in a moment.",
    );

    setPin.mockRejectedValueOnce(new Error("nope"));
    await act(async () => sheet().props.onTogglePin(sheet().props.target));
    expect(screenText(tree)).toContain(
      "Couldn't pin “Alumni mixer flyer”. Try again in a moment.",
    );
  });

  it("marks a pinned or starred row for a screen reader", () => {
    const tree = loaded();
    const row = (label: string) =>
      tree.root
        .findAllByType(ListRow)
        .find((entry) => entry.props.label === label)!;
    expect(row("Chapter bylaws").props.accessibilityValue).toBe(
      "Pinned for the chapter",
    );
    expect(row("Budget FY2026").props.accessibilityValue).toBe("Starred");
    expect(row("Alumni mixer flyer").props.accessibilityValue).toBeUndefined();
  });

  const card = (tree: ReactTestRenderer, title: string) =>
    tree.root
      .findByType(MarkedCards)
      .findAllByType(PressableRow)
      .find((entry) => entry.props.accessibilityLabel === title)!;

  it("draws both marks on a folder chip both pinned and starred", () => {
    documentRows = LIBRARY;
    folderRows = FOLDERS;
    starRows = { folder_ids: ["f-3"], document_ids: [] };
    const tree = render();
    const rush = (folderChips(tree).props.chips as {
      label: string;
      mark?: React.ReactElement<{ children: React.ReactNode }>;
    }[]).find((chip) => chip.label === "Rush")!;
    const marks = React.Children.toArray(rush.mark!.props.children);
    expect(marks).toHaveLength(2);
  });

  it("names a card's long press for what the viewer may do, and fires it", () => {
    const member = loaded();
    const memberCard = card(member, "Rush");
    expect(memberCard.props.accessibilityActions).toEqual([
      { name: "longpress", label: "Star or unstar" },
    ]);
    act(() =>
      memberCard.props.onAccessibilityAction({
        nativeEvent: { actionName: "longpress" },
      }),
    );
    expect(member.root.findByType(DocumentActionsSheet).props.target).toEqual(
      expect.objectContaining({ kind: "folder", id: "f-3" }),
    );

    permissions = ["chapter_docs:manage"];
    const officer = loaded();
    expect(
      card(officer, "Chapter bylaws").props.accessibilityActions,
    ).toEqual([{ name: "longpress", label: "Star, pin or delete" }]);
  });

  it("takes no press on a card whose file is being deleted", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
    permissions = ["chapter_docs:manage"];
    deleteDocument.mockImplementation(() => new Promise(() => {}));
    const tree = loaded();
    act(() =>
      tree.root
        .findAllByType(ListRow)
        .find((row) => row.props.label === "Chapter bylaws")!
        .props.onLongPress(),
    );
    const sheet = tree.root.findByType(DocumentActionsSheet);
    act(() => sheet.props.onDelete(sheet.props.target));
    const confirm = alert.mock.calls[0]![2]!.find(
      (button) => button.style === "destructive",
    )!;
    act(() => confirm.onPress!());

    const bylaws = card(tree, "Chapter bylaws");
    expect(bylaws.props.disabled).toBe(true);
    expect(bylaws.props.onLongPress).toBeUndefined();
    expect(bylaws.props.accessibilityActions).toBeUndefined();
    alert.mockRestore();
  });

  it("says when the stars couldn't be read", () => {
    starsFailed = true;
    documentRows = LIBRARY;
    folderRows = FOLDERS;
    expect(screenText(render())).toContain(
      "Couldn't load your stars. Pull down to try again.",
    );
  });
});

/**
 * #4175: List or Grid, its switch on the title row and kept on this phone.
 * Grid lays the same rows out two to a line as tiles that take the row's tap
 * and long press, so the layout changes nothing a member can do.
 */
describe("Documents as a grid (#4175)", () => {
  const tiles = (tree: ReactTestRenderer) =>
    tree.root
      .findByType(DocumentTiles)
      .findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          typeof node.props.accessibilityLabel === "string",
      );

  it("offers List and Grid on the title row, on List until picked", () => {
    documentRows = [{ id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" }];
    const tree = render();
    expect(tree.root.findByType(ListLayoutToggle).props.screen).toBe("documents");
    expect(tree.root.findAllByType(DocumentTiles)).toHaveLength(0);
    expect(tree.root.findAllByType(ListRow)).toHaveLength(1);
  });

  it("lays the files out as tiles, two to a line, naming each file's type", () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z", storage_path: "c/d1/bylaws.pdf" },
      { id: "d2", title: "Minutes", created_at: "2026-10-01T12:00:00Z" },
      { id: "d3", title: "Roster", created_at: "2026-09-01T12:00:00Z", storage_path: "c/d3/roster.xlsx" },
    ];
    act(() => setListLayout("documents", "grid"));
    const tree = render();
    expect(tree.root.findAllByType(ListRow)).toHaveLength(0);
    expect(tiles(tree).map((tile) => tile.props.accessibilityLabel)).toEqual([
      "Bylaws",
      "Minutes",
      "Roster",
    ]);
    const text = screenText(tree);
    expect(text).toContain("PDF");
    expect(text).toContain("Excel spreadsheet");
  });

  it("opens a file on a tap and its sheet on a long press, as a row does", async () => {
    documentRows = [{ id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" }];
    download.mockResolvedValue({ downloadUrl: "https://signed/bylaws" });
    act(() => setListLayout("documents", "grid"));
    const tree = render();

    await act(async () => {
      tiles(tree)[0]!.props.onPress();
    });
    expect(download).toHaveBeenCalledWith("d1");

    act(() => tiles(tree)[0]!.props.onLongPress());
    expect(tree.root.findByType(DocumentActionsSheet).props.target).toMatchObject({
      kind: "document",
      id: "d1",
      name: "Bylaws",
    });
  });

  it("marks a pinned or starred tile, on screen and for a screen reader", () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z", pinned_at: "2026-10-03T12:00:00Z" },
      { id: "d2", title: "Budget", created_at: "2026-10-01T12:00:00Z" },
      { id: "d3", title: "Flyer", created_at: "2026-09-01T12:00:00Z" },
    ];
    starRows = { folder_ids: [], document_ids: ["d1", "d2"] };
    act(() => setListLayout("documents", "grid"));
    const tree = render();
    const value = (label: string) =>
      tiles(tree).find((tile) => tile.props.accessibilityLabel === label)!
        .props.accessibilityValue;
    expect(value("Bylaws")).toEqual({ text: "Pinned for the chapter, Starred" });
    expect(value("Budget")).toEqual({ text: "Starred" });
    expect(value("Flyer")).toBeUndefined();
    const grid = tree.root.findByType(DocumentTiles);
    expect(grid.findAllByType(PinGlyph)).toHaveLength(1);
    expect(grid.findAllByType(StarGlyph)).toHaveLength(2);
  });

  it("keeps an upload in flight as a row above the tiles", () => {
    permissions = ["*"];
    documentRows = [{ id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" }];
    act(() => setListLayout("documents", "grid"));
    const tree = render();
    act(() => {
      tree.root
        .find((node) => typeof node.props.onPending === "function")
        .props.onPending({ title: "Look at this", failed: null });
    });
    const rows = tree.root.findAllByType(ListRow);
    expect(rows.map((row) => [row.props.label, row.props.description])).toEqual([
      ["Look at this", "Uploading…"],
    ]);
    expect(tiles(tree).map((tile) => tile.props.accessibilityLabel)).toEqual([
      "Bylaws",
    ]);
  });

  it("takes no second press or long press on a tile whose file is opening", async () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
      { id: "d2", title: "Minutes", created_at: "2026-10-01T12:00:00Z" },
    ];
    download.mockReturnValue(new Promise(() => undefined));
    act(() => setListLayout("documents", "grid"));
    const tree = render();
    await act(async () => {
      tiles(tree)[0]!.props.onPress();
    });
    const [opening, idle] = tiles(tree);
    expect(opening!.props.disabled).toBe(true);
    expect(opening!.props.accessibilityState).toEqual({ busy: true });
    expect(opening!.props.onLongPress).toBeUndefined();
    expect(opening!.props.accessibilityActions).toBeUndefined();
    // The other tile still takes both, as the other rows do.
    expect(idle!.props.disabled).toBe(false);
    expect(idle!.props.onLongPress).toBeInstanceOf(Function);
  });
});

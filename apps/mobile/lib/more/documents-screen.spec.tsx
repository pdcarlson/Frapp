/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
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

const accessQuery = vi.hoisted(() => ({
  data: undefined as
    { options: unknown[]; always: string[] | null } | undefined,
  isSuccess: false,
  isError: false,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  usePermissionList: () => permissions,
  // Who can see (#5216): unread by default, so the upload sheet shows no row.
  useDocumentAccessOptions: () => accessQuery,
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

// The download and the share sheet (#4409) are `document-file.ts`'s, pinned
// in its own spec. This stand-in presents at once, unless a spec holds the
// sheet up (`holdSheet`), and records each document whose sheet appeared.
const presented: string[] = [];
let holdSheet: Promise<void> | null = null;
async function presentAtOnce(
  _id: string,
  payload: unknown,
  shouldPresent: () => boolean,
): Promise<boolean> {
  if (!shouldPresent()) return true;
  presented.push((payload as { forcedDownloadUrl: string }).forcedDownloadUrl);
  await holdSheet;
  return true;
}
const shareDocument = vi.fn(presentAtOnce);
vi.mock("@/lib/more/document-file", () => ({
  shareDocumentFile: (...args: Parameters<typeof shareDocument>) =>
    shareDocument(...args),
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
  presented.length = 0;
  holdSheet = null;
  shareDocument.mockReset().mockImplementation(presentAtOnce);
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

  it("says not everyone can see a file with its own list or in a limited folder (#5216)", () => {
    folderRows = [
      { id: "f1", name: "Exec", sort_order: 0, who_can_see: ["tier:t-1"] },
      { id: "f2", name: "Rush", sort_order: 1 },
    ];
    documentRows = [
      {
        id: "d1",
        title: "Budget",
        folder: "Exec",
        created_at: "2026-10-03T12:00:00Z",
      },
      {
        id: "d2",
        title: "Bids",
        folder: "Rush",
        who_can_see: ["role:r-1"],
        created_at: "2026-10-02T12:00:00Z",
      },
      {
        id: "d3",
        title: "Schedule",
        folder: "Rush",
        created_at: "2026-10-01T12:00:00Z",
      },
      // Their own upload in a folder they no longer pass, so not listed.
      {
        id: "d4",
        title: "Ledger",
        folder: "Treasury",
        created_at: "2026-09-30T12:00:00Z",
      },
    ];
    const tree = render();
    const values = Object.fromEntries(
      tree.root
        .findAllByType(ListRow)
        .map((row) => [row.props.label, row.props.accessibilityValue]),
    );

    expect(values.Budget).toContain("Not everyone can see this");
    expect(values.Bids).toContain("Not everyone can see this");
    expect(values.Schedule ?? "").not.toContain("Not everyone can see this");
    expect(values.Ledger).toContain("Not everyone can see this");
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
      settle({ forcedDownloadUrl: "https://signed/bylaws" });
    });
    expect(rows().map((row) => row.props.busy)).toEqual([false, false]);
  });

  // A tap on another row while one is opening used to be dropped without a
  // sign. Now the latest tap wins: the spinner moves, and the first row's
  // URL, landing late, presents nothing.
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
      settle.d1!({ forcedDownloadUrl: "https://signed/bylaws" });
    });
    expect(shareDocument).not.toHaveBeenCalled();
    expect(rows().map((row) => row.props.busy)).toEqual([false, true]);

    await act(async () => {
      settle.d2!({ forcedDownloadUrl: "https://signed/minutes" });
    });
    expect(shareDocument).toHaveBeenCalledTimes(1);
    expect(shareDocument).toHaveBeenCalledWith(
      "d2",
      { forcedDownloadUrl: "https://signed/minutes" },
      expect.any(Function),
    );
    expect(presented).toEqual(["https://signed/minutes"]);
    expect(rows().map((row) => row.props.busy)).toEqual([false, false]);
  });

  // The same race one step later (#4409): the first row's file is still
  // downloading when the member taps another. Its sheet must not come up over
  // the document asked for since.
  it("presents no sheet for a file that lands after another row was tapped", async () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
      { id: "d2", title: "Minutes", created_at: "2026-10-01T12:00:00Z" },
    ];
    download.mockImplementation(async (id: string) => ({
      forcedDownloadUrl: `https://signed/${id}`,
    }));
    const landed: Record<string, () => void> = {};
    shareDocument.mockImplementation(
      (id: string, payload: unknown, shouldPresent: () => boolean) =>
        new Promise((resolve) => {
          landed[id] = () => {
            if (shouldPresent()) {
              presented.push(
                (payload as { forcedDownloadUrl: string }).forcedDownloadUrl,
              );
            }
            resolve(true);
          };
        }),
    );
    const tree = render();
    const rows = () => tree.root.findAllByType(ListRow);

    await act(async () => {
      rows()[0]!.props.onPress();
    });
    expect(rows().map((row) => row.props.busy)).toEqual([true, false]);
    await act(async () => {
      rows()[1]!.props.onPress();
    });
    expect(rows().map((row) => row.props.busy)).toEqual([false, true]);

    await act(async () => {
      landed.d1!();
    });
    expect(presented).toEqual([]);
    await act(async () => {
      landed.d2!();
    });
    expect(presented).toEqual(["https://signed/d2"]);
    expect(rows().map((row) => row.props.busy)).toEqual([false, false]);
    expect(screenText(tree)).not.toContain("couldn't be opened");
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
      settle.d2!.resolve({ forcedDownloadUrl: "https://signed/minutes" });
    });
    expect(presented).toEqual(["https://signed/minutes"]);
    expect(screenText(tree)).not.toContain("couldn't be opened");
    expect(rows().map((row) => row.props.busy)).toEqual([false, false]);
  });

  // A file that couldn't be downloaded or shared (an expired link, no
  // network, a type the library doesn't take) says so under the list.
  it("says the document couldn't be opened when the download or sheet fails", async () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
    ];
    download.mockResolvedValue({ forcedDownloadUrl: "https://signed/d1" });
    shareDocument.mockResolvedValueOnce(false);
    const tree = render();
    const rows = () => tree.root.findAllByType(ListRow);

    await act(async () => {
      rows()[0]!.props.onPress();
    });
    expect(screenText(tree)).toContain("couldn't be opened");
    expect(rows()[0]!.props.busy).toBe(false);
  });

  // A stale tap's failed download (an expired link, say) lands while the
  // member waits on a newer row: it says nothing, and the newer row opens.
  it("keeps a stale tap's failed download off the screen", async () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
      { id: "d2", title: "Minutes", created_at: "2026-10-01T12:00:00Z" },
    ];
    download.mockImplementation(async (id: string) => ({
      forcedDownloadUrl: `https://signed/${id}`,
    }));
    const landed: Record<string, (ok: boolean) => void> = {};
    shareDocument.mockImplementation(
      (id: string, payload: unknown, shouldPresent: () => boolean) =>
        new Promise((resolve) => {
          landed[id] = (ok) => {
            if (ok && shouldPresent()) {
              presented.push(
                (payload as { forcedDownloadUrl: string }).forcedDownloadUrl,
              );
            }
            resolve(ok);
          };
        }),
    );
    const tree = render();
    const rows = () => tree.root.findAllByType(ListRow);

    await act(async () => {
      rows()[0]!.props.onPress();
    });
    await act(async () => {
      rows()[1]!.props.onPress();
    });
    await act(async () => {
      landed.d1!(false);
    });
    expect(screenText(tree)).not.toContain("couldn't be opened");
    await act(async () => {
      landed.d2!(true);
    });
    expect(presented).toEqual(["https://signed/d2"]);
    expect(screenText(tree)).not.toContain("couldn't be opened");
  });

  // A stale tap that finishes while a newer row's sheet is up must leave the
  // one-sheet guard alone: clearing it would let a third tap start a second
  // presentation, which iOS refuses with "couldn't be opened".
  it("keeps the one-sheet guard while a stale tap finishes under another row's sheet", async () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
      { id: "d2", title: "Minutes", created_at: "2026-10-01T12:00:00Z" },
      { id: "d3", title: "Roster", created_at: "2026-09-01T12:00:00Z" },
    ];
    const settle: Record<string, (value: unknown) => void> = {};
    download.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          settle[id] = resolve;
        }),
    );
    let dismiss!: () => void;
    holdSheet = new Promise((resolve) => {
      dismiss = resolve;
    });
    const tree = render();
    const rows = () => tree.root.findAllByType(ListRow);

    await act(async () => {
      rows()[0]!.props.onPress();
    });
    await act(async () => {
      rows()[1]!.props.onPress();
    });
    await act(async () => {
      settle.d2!({ forcedDownloadUrl: "https://signed/d2" });
    });
    expect(presented).toEqual(["https://signed/d2"]);
    // d1 lands now, stale, and finishes while d2's sheet is up.
    await act(async () => {
      settle.d1!({ forcedDownloadUrl: "https://signed/d1" });
    });
    await act(async () => {
      rows()[2]!.props.onPress();
    });
    expect(download).toHaveBeenCalledTimes(2);

    await act(async () => {
      dismiss();
    });
  });

  // Back pops s12. A file still downloading then lands with no screen to
  // present over: no sheet comes up over wherever the member went.
  it("presents nothing for a file that lands after s12 has closed", async () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
    ];
    download.mockResolvedValue({ forcedDownloadUrl: "https://signed/d1" });
    let land!: () => void;
    shareDocument.mockImplementation(
      (_id: string, payload: unknown, shouldPresent: () => boolean) =>
        new Promise((resolve) => {
          land = () => {
            if (shouldPresent()) {
              presented.push(
                (payload as { forcedDownloadUrl: string }).forcedDownloadUrl,
              );
            }
            resolve(true);
          };
        }),
    );
    const tree = render();

    await act(async () => {
      tree.root.findAllByType(ListRow)[0]!.props.onPress();
    });
    act(() => tree.unmount());
    mounted.splice(mounted.indexOf(tree), 1);
    await act(async () => {
      land();
    });
    expect(presented).toEqual([]);
  });

  // Once a document's sheet is up, a tap that reaches another row does
  // nothing. iOS refuses a second presentation, and that refusal would show
  // "couldn't be opened" over the document that did open.
  it("starts no second sheet while the first is still up", async () => {
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
      { id: "d2", title: "Minutes", created_at: "2026-10-01T12:00:00Z" },
    ];
    download.mockImplementation(async (id: string) => ({
      forcedDownloadUrl: `https://signed/${id}`,
    }));
    let dismiss!: () => void;
    holdSheet = new Promise((resolve) => {
      dismiss = resolve;
    });
    const tree = render();
    const rows = () => tree.root.findAllByType(ListRow);

    await act(async () => {
      rows()[0]!.props.onPress();
    });
    expect(presented).toEqual(["https://signed/d1"]);

    await act(async () => {
      rows()[1]!.props.onPress();
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(presented).toEqual(["https://signed/d1"]);
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
  // The filter and sort sheets (#5278), by their titles.
  const sheet = (tree: ReactTestRenderer, title: string) =>
    tree.root.find(
      (node) =>
        node.props.title === title &&
        Array.isArray(node.props.options) &&
        typeof node.props.onSelect === "function",
    );
  const sheetLabels = (tree: ReactTestRenderer, title: string) =>
    (sheet(tree, title).props.options as { label: string }[]).map(
      (option) => option.label,
    );

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

  it("sorts from the control over the list and filters from the chips, each naming its pick", () => {
    const tree = loaded();
    expect(byLabel(tree, "Sort: Name A–Z")).toBeDefined();

    act(() => sheet(tree, "Sort by").props.onSelect("newest"));
    expect(rowLabels(tree)).toEqual([
      "Budget FY2026",
      "Alumni mixer flyer",
      "Chapter bylaws",
    ]);

    expect(byLabel(tree, "Sort: Newest first")).toBeDefined();

    act(() => sheet(tree, "Uploaded by").props.onSelect("u-ryan"));
    expect(rowLabels(tree)).toEqual(["Chapter bylaws"]);
    expect(byLabel(tree, "Uploaded by: Ryan Castellano")).toBeDefined();
    // Clear leads the row once a filter is set. It leaves the order and
    // what was typed: the search is not one of the row's filters.
    act(() => byLabel(tree, "Search documents").props.onChangeText("c"));
    act(() => byLabel(tree, "Clear filters").props.onPress());
    expect(byLabel(tree, "Search documents").props.value).toBe("c");
    expect(byLabel(tree, "Sort: Newest first")).toBeDefined();
    act(() => byLabel(tree, "Search documents").props.onChangeText(""));
    expect(rowLabels(tree)).toHaveLength(3);
    // Nothing set, no Clear.
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Clear filters",
      ),
    ).toHaveLength(0);
  });

  it("opens each chip's sheet and the sort's with one tap", () => {
    const tree = loaded();
    for (const label of [
      "Type",
      "Uploaded by",
      "Date added",
      "Sort: Name A–Z",
    ]) {
      present.mockClear();
      act(() => byLabel(tree, label).props.onPress());
      expect(present).toHaveBeenCalledTimes(1);
    }
  });

  it("names a date pick on its chip and lights it", () => {
    const tree = loaded();
    act(() => sheet(tree, "Date added").props.onSelect("30d"));
    const chip = byLabel(tree, "Date added: Last 30 days");
    expect(chip.props.accessibilityState).toEqual({ selected: true });
    expect(sheet(tree, "Date added").props.selected).toBe("30d");
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
    expect(sheetLabels(tree, "File type")).toEqual([
      "Any type",
      "PDF",
      "Spreadsheet",
      "Other",
    ]);

    act(() => sheet(tree, "File type").props.onSelect("spreadsheet"));
    expect(rowLabels(tree)).toEqual(["Budget FY2026"]);
    expect(byLabel(tree, "Type: Spreadsheet")).toBeDefined();

    act(() => sheet(tree, "File type").props.onSelect(null));
    expect(byLabel(tree, "Type")).toBeDefined();
    act(() => byLabel(tree, "Search documents").props.onChangeText("pdf"));
    expect(rowLabels(tree)).toEqual(["Chapter bylaws"]);
  });

  it("offers This semester only once the archives have loaded", () => {
    semesterRows = undefined;
    const tree = loaded();
    expect(sheetLabels(tree, "Date added")).toEqual([
      "Any time",
      "Last 30 days",
    ]);

    semesterRows = [
      { end_date: "2026-08-31", created_at: "2026-09-01T00:00:00Z" },
    ];
    const later = loaded();
    act(() => sheet(later, "Date added").props.onSelect("semester"));
    expect(rowLabels(later)).toEqual(["Alumni mixer flyer", "Budget FY2026"]);
  });

  it("says a filter matched nothing and clears it", () => {
    const tree = loaded();
    act(() => sheet(tree, "Uploaded by").props.onSelect("u-ryan"));
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

  it("filters to Pinned, Starred or either from the chip row, with the search (#4290)", () => {
    const tree = loaded();
    const toggle = (label: string) =>
      tree.root.find(
        (node) =>
          node.props.accessibilityRole === "togglebutton" &&
          node.props.label === label,
      );
    expect(toggle("Starred").props.accessibilityState).toEqual({
      checked: false,
    });

    act(() => toggle("Starred").props.onPress());
    expect(toggle("Starred").props.accessibilityState).toEqual({
      checked: true,
    });
    // Any filter swaps the cards for the list, the tiers leading it.
    expect(tree.root.findAllByType(MarkedCards)).toHaveLength(0);
    expect(rowLabels(tree)).toEqual(["Budget FY2026"]);
    // Clear leads the row while a filter is on.
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Clear filters",
      ).length,
    ).toBeGreaterThan(0);

    act(() => toggle("Pinned").props.onPress());
    expect(rowLabels(tree)).toEqual(["Chapter bylaws", "Budget FY2026"]);

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
    expect(toggle("Pinned").props.accessibilityState).toEqual({
      checked: false,
    });
    expect(rowLabels(tree)).toEqual([
      "Alumni mixer flyer",
      "Budget FY2026",
      "Chapter bylaws",
    ]);
  });

  it("keeps a file unstarred from the sheet under Starred until the filter changes (#4290)", async () => {
    const tree = loaded();
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
    const rush = (
      folderChips(tree).props.chips as {
        label: string;
        mark?: React.ReactElement<{ children: React.ReactNode }>;
      }[]
    ).find((chip) => chip.label === "Rush")!;
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
    expect(card(officer, "Chapter bylaws").props.accessibilityActions).toEqual([
      { name: "longpress", label: "Star, pin or delete" },
    ]);
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
describe("Documents folder tree (#5337)", () => {
  // A synced Drive tree, named by path as Drive sync names its folders.
  const FOLDERS = [
    { id: "t-1", name: "Town in Fiji", sort_order: 0 },
    { id: "t-2", name: "Town in Fiji / Rush", sort_order: 1 },
    { id: "t-3", name: "Town in Fiji / Rush / 2024", sort_order: 2 },
    { id: "t-4", name: "Town in Fiji / Rush / 2025", sort_order: 3 },
    { id: "t-5", name: "Town in Fiji / Formal", sort_order: 4 },
    { id: "t-6", name: "Bylaws", sort_order: 5 },
  ];
  const LIBRARY = [
    {
      id: "d-1",
      title: "2024 flyer",
      folder: "Town in Fiji / Rush / 2024",
      created_at: "2026-08-12T14:00:00.000Z",
    },
    {
      id: "d-2",
      title: "Rush schedule",
      folder: "Town in Fiji / Rush",
      created_at: "2026-08-13T14:00:00.000Z",
    },
  ];

  function loaded() {
    documentRows = LIBRARY;
    folderRows = FOLDERS;
    starRows = { folder_ids: [], document_ids: [] };
    return render();
  }
  const folderChips = (tree: ReactTestRenderer) =>
    tree.root
      .findAllByType(FilterChips)
      .find((chips) => chips.props.accessibilityLabel === "Filter by folder")!;
  const chips = (tree: ReactTestRenderer) =>
    (
      folderChips(tree).props.chips as {
        value: string | null;
        label: string;
        trailing?: unknown;
        accessibilityLabel?: string;
      }[]
    ).map((chip) => chip.accessibilityLabel ?? chip.label);
  const rowLabels = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(ListRow).map((row) => row.props.label as string);

  it("shows the top level, marking a folder that holds folders", () => {
    expect(chips(loaded())).toEqual([
      "All",
      "Town in Fiji, holds folders",
      "Bylaws",
    ]);
  });

  it("steps into a folder that holds folders, its own files one tap away", () => {
    const tree = loaded();
    act(() => folderChips(tree).props.onSelect("Town in Fiji / Rush"));
    expect(chips(tree)).toEqual([
      "Back to Town in Fiji",
      "Rush",
      "2024",
      "2025",
    ]);
    expect(folderChips(tree).props.selected).toBe("Town in Fiji / Rush");
    // Rush's own files only, not its folders'.
    expect(rowLabels(tree)).toEqual(["Rush schedule"]);
  });

  it("names where a pinned folder lives when it leads the top row, and on its card", () => {
    documentRows = LIBRARY;
    folderRows = FOLDERS.map((entry) =>
      entry.id === "t-3"
        ? { ...entry, pinned_at: "2026-11-17T00:00:00.000Z" }
        : entry,
    );
    starRows = { folder_ids: [], document_ids: [] };
    const tree = render();
    const top = folderChips(tree).props.chips as {
      label: string;
      accessibilityLabel?: string;
    }[];
    expect(top[1]).toMatchObject({
      label: "2024 · Rush",
      accessibilityLabel: "2024, in Town in Fiji / Rush",
    });
    expect(screenText(tree)).toContain("In Town in Fiji / Rush · 1 file");
  });

  it("keeps a folder that holds none among its siblings, and steps back out", () => {
    const tree = loaded();
    act(() => folderChips(tree).props.onSelect("Town in Fiji / Rush / 2024"));
    expect(chips(tree)).toEqual([
      "Back to Town in Fiji",
      "Rush",
      "2024",
      "2025",
    ]);
    expect(rowLabels(tree)).toEqual(["2024 flyer"]);
    act(() => folderChips(tree).props.onSelect("Town in Fiji"));
    expect(chips(tree)).toEqual([
      "Back to All",
      "Town in Fiji",
      "Rush, holds folders",
      "Formal",
    ]);
    act(() => folderChips(tree).props.onSelect(null));
    expect(chips(tree)[0]).toBe("All");
  });
});

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
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
    ];
    const tree = render();
    expect(tree.root.findByType(ListLayoutToggle).props.screen).toBe(
      "documents",
    );
    expect(tree.root.findAllByType(DocumentTiles)).toHaveLength(0);
    expect(tree.root.findAllByType(ListRow)).toHaveLength(1);
  });

  it("lays the files out as tiles, two to a line, naming each file's type", () => {
    documentRows = [
      {
        id: "d1",
        title: "Bylaws",
        created_at: "2026-10-02T12:00:00Z",
        storage_path: "c/d1/bylaws.pdf",
      },
      { id: "d2", title: "Minutes", created_at: "2026-10-01T12:00:00Z" },
      {
        id: "d3",
        title: "Roster",
        created_at: "2026-09-01T12:00:00Z",
        storage_path: "c/d3/roster.xlsx",
      },
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
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
    ];
    download.mockResolvedValue({ forcedDownloadUrl: "https://signed/bylaws" });
    act(() => setListLayout("documents", "grid"));
    const tree = render();

    await act(async () => {
      tiles(tree)[0]!.props.onPress();
    });
    expect(download).toHaveBeenCalledWith("d1");

    act(() => tiles(tree)[0]!.props.onLongPress());
    expect(
      tree.root.findByType(DocumentActionsSheet).props.target,
    ).toMatchObject({
      kind: "document",
      id: "d1",
      name: "Bylaws",
    });
  });

  it("marks a pinned or starred tile, on screen and for a screen reader", () => {
    documentRows = [
      {
        id: "d1",
        title: "Bylaws",
        created_at: "2026-10-02T12:00:00Z",
        pinned_at: "2026-10-03T12:00:00Z",
      },
      { id: "d2", title: "Budget", created_at: "2026-10-01T12:00:00Z" },
      { id: "d3", title: "Flyer", created_at: "2026-09-01T12:00:00Z" },
    ];
    starRows = { folder_ids: [], document_ids: ["d1", "d2"] };
    act(() => setListLayout("documents", "grid"));
    const tree = render();
    const value = (label: string) =>
      tiles(tree).find((tile) => tile.props.accessibilityLabel === label)!.props
        .accessibilityValue;
    expect(value("Bylaws")).toEqual({
      text: "Pinned for the chapter, Starred",
    });
    expect(value("Budget")).toEqual({ text: "Starred" });
    expect(value("Flyer")).toBeUndefined();
    const grid = tree.root.findByType(DocumentTiles);
    expect(grid.findAllByType(PinGlyph)).toHaveLength(1);
    expect(grid.findAllByType(StarGlyph)).toHaveLength(2);
  });

  it("keeps an upload in flight as a row above the tiles", () => {
    permissions = ["*"];
    documentRows = [
      { id: "d1", title: "Bylaws", created_at: "2026-10-02T12:00:00Z" },
    ];
    act(() => setListLayout("documents", "grid"));
    const tree = render();
    act(() => {
      tree.root
        .find((node) => typeof node.props.onPending === "function")
        .props.onPending({ title: "Look at this", failed: null });
    });
    const rows = tree.root.findAllByType(ListRow);
    expect(rows.map((row) => [row.props.label, row.props.description])).toEqual(
      [["Look at this", "Uploading…"]],
    );
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

/**
 * Who can see (#5216): the lock a list row wears (above) on the other places
 * a file or folder shows: folder chips, grid tiles, and Pinned and Starred
 * cards.
 */
describe("Documents locks beyond the list (#5216)", () => {
  const locks = (node: { findAll: ReactTestRenderer["root"]["findAll"] }) =>
    node.findAll((child) => child.props.testID === "document-limited").length;

  const limitedLibrary = () => {
    folderRows = [
      {
        id: "f1",
        name: "Exec",
        sort_order: 0,
        who_can_see: ["tier:t-1"],
        pinned_at: "2026-10-01T12:00:00Z",
      },
      { id: "f2", name: "Rush", sort_order: 1 },
    ];
    documentRows = [
      {
        id: "d1",
        title: "Budget",
        folder: "Exec",
        created_at: "2026-10-03T12:00:00Z",
        pinned_at: "2026-10-03T12:00:00Z",
      },
      {
        id: "d2",
        title: "Schedule",
        folder: "Rush",
        created_at: "2026-10-01T12:00:00Z",
        pinned_at: "2026-10-03T12:00:00Z",
      },
    ];
  };

  it("locks a limited folder's chip and no other", () => {
    limitedLibrary();
    const tree = render();
    const chips = tree.root
      .findAllByType(FilterChips)
      .find((node) => node.props.accessibilityLabel === "Filter by folder")!
      .props.chips as { label: string; mark?: React.ReactElement }[];
    const drawn = (mark: React.ReactElement) => {
      let mounted!: ReactTestRenderer;
      act(() => {
        mounted = create(mark);
      });
      const count = locks(mounted.root);
      act(() => mounted.unmount());
      return count;
    };
    const marked = chips
      .filter((chip) => chip.mark)
      .map((chip) => [chip.label, drawn(chip.mark!)]);
    expect(marked).toEqual([["Exec", 1]]);
  });

  it("locks a limited tile and says so", () => {
    limitedLibrary();
    act(() => setListLayout("documents", "grid"));
    const tree = render();
    const tiles = tree.root
      .findByType(DocumentTiles)
      .findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          typeof node.props.accessibilityLabel === "string",
      );
    const budget = tiles.find((t) => t.props.accessibilityLabel === "Budget")!;
    const schedule = tiles.find(
      (t) => t.props.accessibilityLabel === "Schedule",
    )!;
    expect(locks(budget)).toBe(1);
    expect(budget.props.accessibilityValue.text).toContain(
      "Not everyone can see this",
    );
    expect(locks(schedule)).toBe(0);
  });

  it("locks a limited Pinned card, folder or file", () => {
    limitedLibrary();
    const tree = render();
    const cards = tree.root
      .findByType(MarkedCards)
      .findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          typeof node.props.accessibilityLabel === "string",
      );
    const limited = cards
      .filter((card) => locks(card) > 0)
      .map((card) => card.props.accessibilityValue?.text);
    expect(limited).toEqual([
      "Not everyone can see this",
      "Not everyone can see this",
    ]);
    expect(cards.length).toBe(3);
  });
});

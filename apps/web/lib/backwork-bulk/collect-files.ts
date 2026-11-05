/**
 * Turns a drop or a picker selection into the PDFs bulk upload queues
 * (#3499). Folders are walked recursively; anything that isn't a PDF is
 * counted and skipped, so the person sees "3 files skipped" instead of a
 * silent gap.
 */
export type CollectedFiles = { files: File[]; skipped: number };

export function isPdfFile(file: { name: string; type: string }): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

export function collectFromList(list: Iterable<File>): CollectedFiles {
  const files: File[] = [];
  let skipped = 0;
  for (const file of list) {
    if (isPdfFile(file)) files.push(file);
    else skipped += 1;
  }
  return { files, skipped };
}

/** The slice of the File System entry API a drop exposes. */
type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (file: File) => void, fail: (err: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      ok: (entries: Entry[]) => void,
      fail: (err: unknown) => void,
    ) => void;
  };
};

type DropItem = {
  kind: string;
  webkitGetAsEntry?: () => Entry | null;
  getAsFile: () => File | null;
};

/**
 * Reads every file under the dropped items. Entries must be taken from the
 * items synchronously, before the first `await`: the browser empties the
 * `DataTransfer` once the drop handler yields.
 */
export async function collectFromDrop(
  items: ArrayLike<DropItem>,
): Promise<CollectedFiles> {
  const entries: Entry[] = [];
  const looseFiles: File[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.() ?? null;
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) looseFiles.push(file);
    }
  }

  const all: File[] = [...looseFiles];
  for (const entry of entries) {
    await walk(entry, all);
  }
  // A stable order, so a folder of exams queues the way it reads on disk.
  all.sort((a, b) =>
    relativePath(a).localeCompare(relativePath(b), undefined, {
      numeric: true,
    }),
  );
  return collectFromList(all);
}

const PATH_KEY = "__backworkPath";

function relativePath(file: File): string {
  const tagged = (file as File & { [PATH_KEY]?: string })[PATH_KEY];
  return tagged ?? file.webkitRelativePath ?? file.name;
}

async function walk(entry: Entry, out: File[], prefix = ""): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail));
    Object.defineProperty(file, PATH_KEY, { value: path });
    out.push(file);
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // `readEntries` returns at most a batch (100 in Chrome) per call; keep
    // reading until it comes back empty.
    for (;;) {
      const batch = await new Promise<Entry[]>((ok, fail) =>
        reader.readEntries(ok, fail),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, out, path);
    }
  }
}

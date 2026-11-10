/**
 * The files a paste into the chat composer should attach (#2246).
 *
 * Returns an empty list when the paste is text, so the editor's own paste
 * runs untouched. A paste counts as files only when the clipboard carries at
 * least one file **and no plain text**: copying cells from Excel or Numbers,
 * or a passage from Word, puts text on the clipboard alongside a rendered
 * image of it, and the member meant the text. Slack and GitHub's comment box
 * draw the same line. "Copy image" in a browser and a screenshot to the
 * clipboard carry the image and at most an `<img>` in `text/html`, never
 * plain text, so they attach.
 *
 * Nothing here filters by type or size: the files go through the composer's
 * attach path, which refuses what the file picker would refuse, with the
 * same toast.
 */
export function filesFromClipboard(
  data: DataTransfer | null | undefined,
  now: Date = new Date(),
): File[] {
  if (!data) return [];
  if (data.getData("text/plain").trim() !== "") return [];

  let files = Array.from(data.files ?? []);
  // Some browsers leave `files` empty and expose the same files only as items.
  if (files.length === 0) {
    files = Array.from(data.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null);
  }
  if (files.length === 0) return [];

  const generic = files.filter(isGenericName);
  let n = 0;
  return files.map((file) => {
    if (!isGenericName(file)) return file;
    n += 1;
    const suffix = generic.length > 1 ? ` (${n})` : "";
    return new File(
      [file],
      `Pasted image ${stamp(now)}${suffix}.${extensionFor(file)}`,
      { type: file.type, lastModified: file.lastModified },
    );
  });
}

/*
  A screenshot pasted from the clipboard has no name of its own: Chrome and
  Firefox call every one `image.png`, and Safari can leave the name empty.
  Several in one message would all read `image.png` in the chips and in the
  thread, so those get a dated name instead, the way Slack names a pasted
  image. A real file copied from Finder or Explorer keeps its name.
*/
function isGenericName(file: File): boolean {
  return file.name === "" || /^image\.[a-z0-9]+$/i.test(file.name);
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

function extensionFor(file: File): string {
  const fromType = EXTENSIONS[file.type.toLowerCase()];
  if (fromType) return fromType;
  const fromName = /\.([a-z0-9]+)$/i.exec(file.name)?.[1];
  return fromName ? fromName.toLowerCase() : "png";
}

function stamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `${date} at ${time}`;
}

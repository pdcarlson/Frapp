import { viewableImageExtension } from "@repo/chat-core/attachments";

/**
 * The files a paste into the chat composer should attach (#2246).
 *
 * Returns an empty list when the paste is text, so the editor's own paste
 * runs untouched. A paste is files when the clipboard carries at least one
 * file and its plain text, if any, is not something the member meant to type:
 *
 * - No text: a screenshot copied to the clipboard, or Chrome's "Copy image".
 * - A lone URL: Firefox's "Copy Image" puts the image's address in
 *   `text/plain` beside the image itself.
 * - Only the files' own names: a file copied in the macOS Finder arrives with
 *   its name as text.
 *
 * Any other text wins and the files are left out. Copying cells from Excel or
 * Numbers, or a passage from Word, puts text on the clipboard alongside a
 * rendered picture of it, and the member meant the text. Slack and GitHub's
 * comment box draw the same line.
 *
 * Nothing here filters by type or size: the files go through the composer's
 * attach path, which refuses what the file picker would refuse, with the same
 * toast. Renaming (below) never changes a file's type, so it cannot let
 * through a file the picker would refuse.
 */
export function filesFromClipboard(
  data: DataTransfer | null | undefined,
  now: Date = new Date(),
): File[] {
  if (!data) return [];

  let files = Array.from(data.files ?? []);
  // Some browsers leave `files` empty and expose the same files only as items.
  if (files.length === 0) {
    files = Array.from(data.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null);
  }
  if (files.length === 0) return [];
  if (!textIsIncidental(data.getData("text/plain"), files)) return [];

  const renamed = files.map((file) =>
    isUnnamedImage(file) ? viewableImageExtension(file.type) : null,
  );
  const count = renamed.filter((ext) => ext !== null).length;
  let n = 0;
  return files.map((file, i) => {
    const ext = renamed[i];
    if (!ext) return file;
    n += 1;
    const suffix = count > 1 ? ` (${n})` : "";
    return new File([file], `Pasted image ${stamp(now)}${suffix}.${ext}`, {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}

function textIsIncidental(text: string, files: File[]): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return true;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  const names = new Set(files.map((file) => file.name).filter(Boolean));
  const lines = trimmed
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => names.has(line));
}

/*
  A screenshot pasted from the clipboard has no name of its own: Chrome and
  Firefox call every one `image.png`, and Safari can leave the name empty.
  Several in one message would all read `image.png` in the chips and in the
  thread, so those get a dated name instead, the way macOS names a screenshot.

  Only an image whose type maps to a viewable extension is renamed, and it
  keeps that type, so the new name says what the bytes are. Anything else
  keeps the name it came with, and the attach path judges it as the picker
  would: a nameless file of an unknown type is refused there, not relabelled.
  A real file, `image.pdf` included, keeps its name.
*/
function isUnnamedImage(file: File): boolean {
  if (!file.type.toLowerCase().startsWith("image/")) return false;
  return (
    file.name === "" || /^image\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)
  );
}

function stamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `${date} at ${time}`;
}

import { clipboard, Menu, shell, type MenuItemConstructorOptions, type WebContents } from "electron";
import { decideNavigation } from "../shared/navigation";

/**
 * A right-click menu where the web app doesn't draw its own: Cut, Copy,
 * Paste and spelling fixes in a text box, Copy on selected text, and Copy
 * link / Open in browser on a link. Electron has none by default. When the
 * page handles right-click itself (a message's menu), Chromium doesn't raise
 * this event, so the two never both appear.
 */
export function installContextMenu(contents: WebContents): void {
  contents.on("context-menu", (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];

    if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
      items.push({ type: "separator" });
    }

    if (params.linkURL) {
      const decision = decideNavigation(params.linkURL, new URL(contents.getURL()).origin);
      items.push({ label: "Copy Link", click: () => clipboard.writeText(params.linkURL) });
      if (decision.kind === "external") {
        items.push({ label: "Open in Browser", click: () => void shell.openExternal(decision.url) });
      }
      items.push({ type: "separator" });
    }

    if (params.isEditable) {
      items.push(
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll" },
      );
    } else if (params.selectionText.trim()) {
      items.push({ role: "copy" });
    }

    while (items.at(-1)?.type === "separator") items.pop();
    if (items.length > 0) Menu.buildFromTemplate(items).popup();
  });
}

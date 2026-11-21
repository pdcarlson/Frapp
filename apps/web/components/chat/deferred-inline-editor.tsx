"use client";

import type { ComponentPropsWithRef } from "react";
import { deferredPanel } from "./deferred-panel";
import type { InlineMessageEditor as InlineMessageEditorComponent } from "./inline-message-editor";

/**
 * A message's in-place edit box (#5050), the composer's rich editor too. It
 * draws only once a member clicks Edit, which is after the preload below on
 * all but the slowest opens; until then the row shows nothing in its place.
 */
export const InlineMessageEditor = deferredPanel<
  ComponentPropsWithRef<typeof InlineMessageEditorComponent>
>(
  () => import("./inline-message-editor").then((m) => m.InlineMessageEditor),
  "slot",
);

/**
 * Fetches the edit box and hands it over, so the first Edit after the preload
 * draws at once instead of blanking the row through a Suspense pass.
 * `preloadChatPanels` calls it once the page is idle.
 */
export function preloadInlineMessageEditor(): Promise<void> {
  return import("./inline-message-editor")
    .then((m) => InlineMessageEditor.adopt(m.InlineMessageEditor))
    .catch(() => undefined);
}

"use client";

import { useEffect, type ComponentType } from "react";
import type { ComposerProps } from "./composer";
import {
  ComposerShell,
  composerCanPost,
  holdDroppedFiles,
} from "./composer-shell";
import { deferredPanel, type DeferredPanel } from "./deferred-panel";
import { preloadInlineMessageEditor } from "./deferred-inline-editor";

/*
 * The chat shell's dialogs, sheets and + card forms, kept out of the
 * JavaScript a cold open downloads before its first screen (#3716).
 *
 * The shell is on every dashboard route, so everything it imports statically
 * is in that download. None of these draws until a member opens it: the + card's
 * forms, the full event editor, a member's profile, an open thread.
 * `preloadChatPanels` fetches them once the page is idle, so they still reach
 * every member (`performance-budgets.md` § Bundle size has the measured
 * saving); what moved is when. A click before the preload lands waits for its
 * chunk.
 *
 * Two exceptions (#5050). The composer draws as soon as there is a channel,
 * so the chat shell starts its chunk as it mounts, and `ComposerShell` stands
 * in until it arrives. A message's edit box draws on Edit, like the panels; it
 * lives in `deferred-inline-editor.tsx`, because the row that imports it is
 * itself inside the thread panel split here.
 *
 * Not `next/dynamic`, because of what a failed load does there. It is
 * `React.lazy` held in a module-level binding, and `React.lazy` keeps a
 * rejection for the life of the document (`lib/chunk-load-error.ts`): the
 * error throws to `ChatPanelBoundary`, which replaces the whole chat panel
 * (and drops the + card's drafts on Retry), and the control stays dead until a
 * reload. On the slow connections this split is for, a member can easily go
 * offline before the preload finishes. So each panel here keeps its own lazy
 * per attempt: a failure draws in the panel's own place, and trying again
 * builds a fresh one. Turbopack drops a failed chunk's resolver, so the fresh
 * import really refetches. When the chunk is gone because a deploy rotated
 * the hashes, only a reload helps, and the copy says so.
 *
 * Each `import()` is written out in full, here and in the preload, because
 * that string is what the bundler splits on.
 */

export const PollForm = deferredPanel(
  () => import("./poll-form").then((m) => m.PollForm),
  "slot",
);
export const SignupForm = deferredPanel(
  () => import("./signup-form").then((m) => m.SignupForm),
  "slot",
);
export const RolePickerForm = deferredPanel(
  () => import("./role-picker-form").then((m) => m.RolePickerForm),
  "slot",
);
export const FormBuilder = deferredPanel(
  () => import("./form-builder").then((m) => m.FormBuilder),
  "slot",
);
export const EventQuickForm = deferredPanel(
  () => import("./event-quick-form").then((m) => m.EventQuickForm),
  "slot",
);
export const TaskForm = deferredPanel(
  () => import("@/components/tasks/task-form").then((m) => m.TaskForm),
  "slot",
);
export const LogHoursForm = deferredPanel(
  () =>
    import("@/components/service/log-hours-form").then((m) => m.LogHoursForm),
  "slot",
);
export const PointsAdjustmentForm = deferredPanel(
  () =>
    import("@/components/points/points-adjustment-form").then(
      (m) => m.PointsAdjustmentForm,
    ),
  "slot",
);
export const ThreadPanel = deferredPanel(
  () => import("./thread-panel").then((m) => m.ThreadPanel),
  "slot",
);
export const EventEditorDialog = deferredPanel(
  () =>
    import("@/components/events/event-editor-dialog").then(
      (m) => m.EventEditorDialog,
    ),
  "dialog",
);
export const MemberDetailSheet = deferredPanel(
  () =>
    import("@/components/members/member-detail-sheet").then(
      (m) => m.MemberDetailSheet,
    ),
  "dialog",
);

/** The chat composer's props, plus the one its loading stand-in reads. */
export type DeferredComposerProps = ComposerProps & {
  /** Focus entering or leaving the stand-in, for `claimShellFocus`. */
  onShellFocusChange?: (focused: boolean) => void;
};

/**
 * What the composer draws while its code loads (#5050): `ComposerShell`, the
 * textarea a cold open shows before the channel list answers, controlled by
 * the channel's draft. It follows that draft, so a draft restored after it
 * mounts shows here and the next keystroke extends it rather than replacing
 * it; it reports only what the member types, so a channel switch can't save
 * the outgoing channel's text under the new one. It takes the caret when the
 * first shell held it (`claimShellFocus`, re-armed by the focus, so the editor
 * takes it next), says the member is typing, and holds files dropped on the
 * channel until the composer can attach them. A member who can't post here
 * gets nothing until the composer's own explanation loads, rather than a box
 * that takes text it can never send.
 */
function ComposerLoading(props: DeferredComposerProps) {
  const canPost = composerCanPost(props);
  const { channelId, dropAttachRef } = props;
  useEffect(() => {
    if (!dropAttachRef || !canPost) return;
    const hold = (files: File[]) => holdDroppedFiles(channelId, files);
    dropAttachRef.current = hold;
    return () => {
      if (dropAttachRef.current === hold) dropAttachRef.current = null;
    };
  }, [canPost, channelId, dropAttachRef]);
  if (!canPost) return null;
  return (
    <ComposerShell
      value={props.draft}
      onTextChange={(text) => {
        props.onChangeDraft(text);
        // As the editor does: an empty box is nobody typing, and a question
        // for Frapp is one nobody else will see arrive (#4713).
        if (text.trim().length > 0 && !/@frapp\b/i.test(text)) {
          props.onTyping();
        }
      }}
      onFocusChange={props.onShellFocusChange}
      claimFocus={props.claimShellFocus}
      hint="Still opening the composer. You can keep typing."
    />
  );
}

/**
 * The composer, with Tiptap and ProseMirror (about 95 KB gzipped) out of every
 * dashboard route's first download (#5050). Chat is a panel of the shell on
 * every route, so its editor used to be in what a cold open fetched before
 * anything worked.
 */
export const Composer = deferredComposer(() =>
  import("./composer").then((m) => m.Composer),
);

/** `Composer`'s construction, apart so a spec can hold the load. */
export function deferredComposer(
  load: () => Promise<ComponentType<DeferredComposerProps>>,
): DeferredPanel<DeferredComposerProps> {
  return deferredPanel(load, "slot", ComposerLoading);
}

/**
 * Fetches every panel above, so the first click on one doesn't wait. A failed
 * preload costs nothing: it never touches a panel's own lazy, so the panel's
 * first open is still a fresh attempt.
 */
export function preloadChatPanels(): void {
  const loads = [
    import("./poll-form"),
    import("./signup-form"),
    import("./role-picker-form"),
    import("./form-builder"),
    import("./event-quick-form"),
    import("@/components/tasks/task-form"),
    import("@/components/service/log-hours-form"),
    import("@/components/points/points-adjustment-form"),
    import("./thread-panel"),
    import("@/components/events/event-editor-dialog"),
    import("@/components/members/member-detail-sheet"),
  ];
  for (const load of loads) load.catch(() => undefined);
  void preloadInlineMessageEditor();
  preloadComposer();
}

/**
 * Starts the composer's chunk (#5050). The chat shell calls it as it mounts,
 * not after first paint like the panels: it mounts only where chat is on
 * screen, and there the editor is wanted as soon as the channel is. Waiting
 * for `<Composer>` to mount would fetch it only after the channel list
 * answers, a round trip later (Slow 4G measured it 1.2 s later than when it
 * was in the first download). The shell takes typing meanwhile either way.
 */
export function preloadComposer(): Promise<void> {
  return import("./composer")
    .then((m) => Composer.adopt(m.Composer))
    .catch(() => undefined);
}

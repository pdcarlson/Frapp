"use client";

import { deferredPanel } from "@/components/shared/deferred-panel";

/*
 * The chat shell's dialogs, sheets and + card forms, deferred with
 * `deferredPanel` (`components/shared/deferred-panel.tsx` says why and how).
 * Each `import()` is written out in full, here and in the preload, because
 * that string is what the bundler splits on.
 */

export { deferredPanel };

export const PollForm = deferredPanel(
  () => import("./poll-form").then((m) => m.PollForm),
  "slot",
);
export const SignupForm = deferredPanel(
  () => import("./signup-form").then((m) => m.SignupForm),
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

/**
 * Fetches every panel above, so the first click on one doesn't wait. A failed
 * preload costs nothing: it never touches a panel's own lazy, so the panel's
 * first open is still a fresh attempt.
 */
export function preloadChatPanels(): void {
  const loads = [
    import("./poll-form"),
    import("./signup-form"),
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
}

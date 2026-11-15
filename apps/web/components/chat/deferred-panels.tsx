"use client";

import dynamic from "next/dynamic";

/*
 * The chat shell's dialogs, sheets and + card forms, loaded when one opens
 * instead of with the shell (#3716).
 *
 * The shell is on every dashboard route, so everything it imports statically
 * is in the JavaScript a cold open downloads before the first screen can draw.
 * None of these draws until a member opens it: the + card's forms, the full
 * event editor, a member's profile, an open thread. Splitting them takes about
 * 120 KB (before compression) off that download. `preloadChatPanels` fetches
 * them once the page is idle, so a click a few seconds in finds them already
 * loaded. A click before that waits for its chunk; the form's card is already
 * open and the form draws into it.
 *
 * Each `import()` is written out in full, here and in the preload, because
 * that string is what the bundler splits on.
 */

export const PollForm = dynamic(
  () => import("./poll-form").then((m) => m.PollForm),
  { ssr: false },
);
export const SignupForm = dynamic(
  () => import("./signup-form").then((m) => m.SignupForm),
  { ssr: false },
);
export const FormBuilder = dynamic(
  () => import("./form-builder").then((m) => m.FormBuilder),
  { ssr: false },
);
export const EventQuickForm = dynamic(
  () => import("./event-quick-form").then((m) => m.EventQuickForm),
  { ssr: false },
);
export const TaskForm = dynamic(
  () => import("@/components/tasks/task-form").then((m) => m.TaskForm),
  { ssr: false },
);
export const LogHoursForm = dynamic(
  () =>
    import("@/components/service/log-hours-form").then((m) => m.LogHoursForm),
  { ssr: false },
);
export const PointsAdjustmentForm = dynamic(
  () =>
    import("@/components/points/points-adjustment-form").then(
      (m) => m.PointsAdjustmentForm,
    ),
  { ssr: false },
);
export const EventEditorDialog = dynamic(
  () =>
    import("@/components/events/event-editor-dialog").then(
      (m) => m.EventEditorDialog,
    ),
  { ssr: false },
);
export const MemberDetailSheet = dynamic(
  () =>
    import("@/components/members/member-detail-sheet").then(
      (m) => m.MemberDetailSheet,
    ),
  { ssr: false },
);
export const ThreadPanel = dynamic(
  () => import("./thread-panel").then((m) => m.ThreadPanel),
  { ssr: false },
);

/** Fetches every panel above, so the first click on one doesn't wait. */
export function preloadChatPanels(): void {
  const loads = [
    import("./poll-form"),
    import("./signup-form"),
    import("./form-builder"),
    import("./event-quick-form"),
    import("@/components/tasks/task-form"),
    import("@/components/service/log-hours-form"),
    import("@/components/points/points-adjustment-form"),
    import("@/components/events/event-editor-dialog"),
    import("@/components/members/member-detail-sheet"),
    import("./thread-panel"),
  ];
  // A failed preload costs nothing: the panel's own load retries on open.
  for (const load of loads) load.catch(() => undefined);
}

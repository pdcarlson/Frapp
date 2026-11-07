import {
  Component,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useActiveChapterId, useDocumentFolders, useEvents } from "@repo/hooks";
import {
  UploadDocumentSheet,
  type PendingDocumentUpload,
} from "@/components/documents/upload-document-sheet";
import { NewEventSheet } from "@/components/events/new-event-sheet";
import { reportRouteError } from "@/components/route-error";
import { LogHoursSheet } from "@/components/service-hours/log-hours-sheet";
import { NewTaskSheet } from "@/components/tasks/new-task-sheet";
import { resolveCheckInWindow } from "@/lib/events/format";
import { selectEventRows } from "@/lib/events/select";
import { selectDocumentFolders } from "@/lib/more/documents";
import type { QuickActionKey } from "@/lib/quick-actions";

type SheetKey = "newEvent" | "newTask" | "logHours" | "upload";

const NONE: ReadonlySet<SheetKey> = new Set();

/** How long a confirmation stays above the bar. */
export const NOTICE_MS = 4000;

/**
 * What each quick action opens (`spec/ui/mobile/navigation.md` § Quick
 * actions). A create action presents its sheet over the screen the member is
 * on; the rest go to the screen that does the job.
 *
 * Each sheet mounts the first time it is asked for, not with the tab bar, so
 * a member who never opens New task never reads the roster for its picker.
 * It then stays mounted, so a closed sheet keeps its draft for the next visit
 * (`spec/ui/mobile/patterns.md` § Bottom sheets). One set per chapter: a draft
 * belongs to the chapter it was started in.
 *
 * A sheet can be opened over any tab, and the one it files into may not be on
 * screen (a task assigned to someone else is on nobody's board here), so each
 * create says it worked in `notice`, which the bar draws above itself.
 */
export function useQuickActionsHost({
  events,
}: {
  /** Whether a check-in action is in reach, so the events list is worth reading. */
  events: boolean;
}): {
  run: (key: QuickActionKey) => void;
  sheets: ReactNode;
  /** The last create's confirmation, for a few seconds, or `null`. */
  notice: string | null;
} {
  const router = useRouter();
  const chapterId = useActiveChapterId() ?? null;
  const eventsQuery = useEvents({ enabled: events });

  const eventRef = useRef<BottomSheetModal>(null);
  const taskRef = useRef<BottomSheetModal>(null);
  const hoursRef = useRef<BottomSheetModal>(null);
  const uploadRef = useRef<BottomSheetModal>(null);
  const refs: Record<SheetKey, RefObject<BottomSheetModal | null>> = useMemo(
    () => ({
      newEvent: eventRef,
      newTask: taskRef,
      logHours: hoursRef,
      upload: uploadRef,
    }),
    [],
  );

  // The sheets mounted so far, for the chapter they were mounted in: a
  // chapter switch starts every sheet over (see above).
  const [opened, setOpened] = useState<{
    chapterId: string | null;
    keys: ReadonlySet<SheetKey>;
  }>({ chapterId, keys: new Set() });
  const mounted: ReadonlySet<SheetKey> =
    opened.chapterId === chapterId ? opened.keys : NONE;
  // A sheet asked for before it mounted is presented once it has.
  const pending = useRef<SheetKey | null>(null);

  // Each confirmation gets an id, so a second one restarts the clock and the
  // first one's timer can't take it down early.
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(
    null,
  );
  const confirm = useCallback((text: string) => {
    setNotice((prev) => ({ id: (prev?.id ?? 0) + 1, text }));
    AccessibilityInfo.announceForAccessibility(text);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice((current) => (current?.id === notice.id ? null : current));
    }, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // A sheet that throws while rendering is dropped, not the tab bar with it
  // (it renders in the navigator's tabBar, outside every screen's boundary).
  // The next ask mounts it fresh.
  const dropSheet = useCallback(
    (key: SheetKey) =>
      setOpened((prev) => {
        const keys = new Set(prev.keys);
        keys.delete(key);
        return { chapterId: prev.chapterId, keys };
      }),
    [],
  );

  // Log hours' date chips and New event's default start read this clock:
  // re-read on each open and when the app comes back, as Service hours does,
  // so "Today" is today.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setNow(new Date());
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const key = pending.current;
    if (!key || !mounted.has(key)) return;
    pending.current = null;
    refs[key].current?.present();
  }, [mounted, refs]);

  const openSheet = useCallback(
    (key: SheetKey) => {
      setNow(new Date());
      if (mounted.has(key)) {
        refs[key].current?.present();
        return;
      }
      pending.current = key;
      setOpened({ chapterId, keys: new Set(mounted).add(key) });
    },
    [chapterId, mounted, refs],
  );

  const run = useCallback(
    (key: QuickActionKey) => {
      switch (key) {
        case "newEvent":
        case "newTask":
        case "logHours":
        case "upload":
          openSheet(key);
          return;
        case "invite":
          // The Invite members screen, whose one button shares a fresh link.
          router.push("/invite");
          return;
        case "message":
          // Pick who to write to; their card's Message opens the thread.
          router.push("/directory");
          return;
        case "study":
          router.push("/study");
          return;
        case "checkIn": {
          // The one event whose check-in is open now goes straight to the
          // scanner. None, or several at once, goes to Events to choose.
          const at = new Date();
          const open = selectEventRows(eventsQuery.data, at).filter(
            (row) =>
              resolveCheckInWindow(row.start_time, row.end_time, at).state ===
              "open",
          );
          if (open.length === 1) {
            router.push({
              pathname: "/check-in",
              params: { eventId: open[0].id },
            });
          } else {
            router.navigate("/events");
          }
          return;
        }
        case "hostCheckIn": {
          // The event an officer would host: the soonest still checkable-in,
          // as More's Host check-in row picks it.
          const next = selectEventRows(eventsQuery.data, new Date())[0];
          if (next) {
            router.push({
              pathname: "/host-check-in",
              params: { eventId: next.id },
            });
          } else {
            router.navigate("/events");
          }
          return;
        }
      }
    },
    [eventsQuery.data, openSheet, router],
  );

  const sheets = (
    <>
      {mounted.has("newEvent") ? (
        <SheetBoundary
          key={`event-${chapterId ?? "none"}`}
          onError={() => dropSheet("newEvent")}
        >
          <NewEventSheet
            ref={eventRef}
            now={now}
            onCreated={() => confirm("Event added.")}
          />
        </SheetBoundary>
      ) : null}
      {mounted.has("newTask") ? (
        <SheetBoundary
          key={`task-${chapterId ?? "none"}`}
          onError={() => dropSheet("newTask")}
        >
          <NewTaskSheet
            ref={taskRef}
            now={now}
            onCreated={(assigneeName, wasSelf) =>
              confirm(
                wasSelf
                  ? "Added to your tasks."
                  : `Assigned to ${assigneeName ?? "your chapter member"}.`,
              )
            }
          />
        </SheetBoundary>
      ) : null}
      {mounted.has("logHours") ? (
        <SheetBoundary
          key={`hours-${chapterId ?? "none"}`}
          onError={() => dropSheet("logHours")}
        >
          <LogHoursSheet
            ref={hoursRef}
            now={now}
            onLogged={() => confirm("Hours logged.")}
          />
        </SheetBoundary>
      ) : null}
      {mounted.has("upload") ? (
        <SheetBoundary
          key={`upload-${chapterId ?? "none"}`}
          onError={() => dropSheet("upload")}
        >
          <QuickUploadSheet
            sheetRef={uploadRef}
            onUploaded={(title) => confirm(`“${title}” is in the library.`)}
            // Upload closes the sheet at once, so the notice carries the
            // upload until it lands, and says so if it didn't.
            onPending={(pending) => {
              if (!pending) return;
              confirm(
                pending.failed
                  ? `“${pending.title}” didn't upload. Open Upload document to try again.`
                  : `Uploading “${pending.title}”…`,
              );
            }}
          />
        </SheetBoundary>
      ) : null}
    </>
  );

  return { run, sheets, notice: notice?.text ?? null };
}

/** Catches a sheet's render error, reports it, and lets the host drop it. */
class SheetBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    reportRouteError(error, { boundary: "sheet" });
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Upload needs the chapter's folders, read only once it is asked for. */
function QuickUploadSheet({
  sheetRef,
  onUploaded,
  onPending,
}: {
  sheetRef: RefObject<BottomSheetModal | null>;
  onUploaded: (title: string) => void;
  onPending: (pending: PendingDocumentUpload | null) => void;
}) {
  const foldersQuery = useDocumentFolders();
  const folders = useMemo(
    () => selectDocumentFolders(foldersQuery.data),
    [foldersQuery.data],
  );
  return (
    <UploadDocumentSheet
      ref={sheetRef}
      folders={folders}
      initialFolder={null}
      onUploaded={onUploaded}
      onPending={onPending}
    />
  );
}

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useActiveChapterId, useDocumentFolders, useEvents } from "@repo/hooks";
import { UploadDocumentSheet } from "@/components/documents/upload-document-sheet";
import { LogHoursSheet } from "@/components/service-hours/log-hours-sheet";
import { NewTaskSheet } from "@/components/tasks/new-task-sheet";
import { resolveCheckInWindow } from "@/lib/events/format";
import { selectEventRows } from "@/lib/events/select";
import { selectDocumentFolders } from "@/lib/more/documents";
import type { QuickActionKey } from "@/lib/quick-actions";
import { announceTaskCreated } from "@/lib/tasks/task-created";

type SheetKey = "newTask" | "logHours" | "upload";

const NONE: ReadonlySet<SheetKey> = new Set();

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
 */
export function useQuickActionsHost({
  events,
}: {
  /** Whether a check-in action is in reach, so the events list is worth reading. */
  events: boolean;
}): {
  run: (key: QuickActionKey) => void;
  sheets: ReactNode;
} {
  const router = useRouter();
  const chapterId = useActiveChapterId() ?? null;
  const eventsQuery = useEvents({ enabled: events });

  const taskRef = useRef<BottomSheetModal>(null);
  const hoursRef = useRef<BottomSheetModal>(null);
  const uploadRef = useRef<BottomSheetModal>(null);
  const refs: Record<SheetKey, RefObject<BottomSheetModal | null>> = useMemo(
    () => ({ newTask: taskRef, logHours: hoursRef, upload: uploadRef }),
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

  // Log hours' date chips read this clock: re-read on each open and when the
  // app comes back, as Service hours does, so "Today" is today.
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
        case "newTask":
        case "logHours":
        case "upload":
          openSheet(key);
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
        case "newEvent":
          // Not in the panel until the mobile event sheet lands
          // (`NEW_EVENT_IN_PANEL`); Events is where it will live.
          router.navigate("/events");
          return;
      }
    },
    [eventsQuery.data, openSheet, router],
  );

  const sheets = (
    <>
      {mounted.has("newTask") ? (
        <NewTaskSheet
          key={`task-${chapterId ?? "none"}`}
          ref={taskRef}
          now={now}
          onCreated={announceTaskCreated}
        />
      ) : null}
      {mounted.has("logHours") ? (
        <LogHoursSheet
          key={`hours-${chapterId ?? "none"}`}
          ref={hoursRef}
          now={now}
        />
      ) : null}
      {mounted.has("upload") ? (
        <QuickUploadSheet
          key={`upload-${chapterId ?? "none"}`}
          sheetRef={uploadRef}
        />
      ) : null}
    </>
  );

  return { run, sheets };
}

/** Upload needs the chapter's folders, read only once it is asked for. */
function QuickUploadSheet({
  sheetRef,
}: {
  sheetRef: RefObject<BottomSheetModal | null>;
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
    />
  );
}

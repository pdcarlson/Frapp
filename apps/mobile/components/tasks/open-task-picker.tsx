import { useEffect, useRef } from "react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { TASK_AUDIENCE_COPY } from "@repo/validation";
import { WhoPickerSheet } from "@/components/tasks/who-picker-sheet";
import { useWhoDirectory } from "@/lib/tasks/use-who-directory";

/**
 * Assign to someone, for a task up for grabs: the Assign to picker limited
 * to one person, over the posting's screen (`open-task-screen.tsx`). A
 * picker, not the posting itself, so it stays a sheet (`patterns.md` §
 * Bottom sheets). Mounted only for the hand-over, so the members read it
 * needs runs only for an officer who asks. It opens as it mounts.
 */
export function OpenTaskAssignPicker({
  onPick,
  onClosed,
}: {
  onPick: (userId: string) => void;
  onClosed: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const read = useWhoDirectory({ groups: false });
  useEffect(() => {
    ref.current?.present();
  }, []);
  return (
    <WhoPickerSheet
      ref={ref}
      single
      title={TASK_AUDIENCE_COPY.assignToSomeone}
      value={null}
      onChange={(who) => {
        if (who?.kind === "person") onPick(who.userId);
      }}
      directory={read.directory}
      people={read.people}
      sets={read.sets}
      onDismiss={onClosed}
    />
  );
}

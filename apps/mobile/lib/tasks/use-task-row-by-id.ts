import { useCallback, useMemo } from "react";
import { useTasks } from "@repo/hooks";
import { records } from "@/lib/more/narrow";
import { toTaskRow, type TaskRowModel } from "@/lib/tasks/board";

/**
 * A task of the viewer's read (`GET /v1/tasks`) by id, as a row: the board's
 * fallback for a task it has let go of, and the long-press menu's lookup
 * (#5492). The rows are indexed once per read, so a lookup per row or per
 * assignee is a map hit, not a scan.
 */
export function useTaskRowById(): (id: string | null) => TaskRowModel | null {
  const { data } = useTasks();
  const byId = useMemo(() => {
    const rows = new Map<string, TaskRowModel>();
    for (const raw of records(data)) {
      const row = toTaskRow(raw);
      if (row) rows.set(row.id, row);
    }
    return rows;
  }, [data]);
  return useCallback(
    (id: string | null) => (id === null ? null : (byId.get(id) ?? null)),
    [byId],
  );
}

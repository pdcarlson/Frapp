"use client";

import { Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useChapterStore } from "@/lib/stores/chapter-store";
import {
  activePreview,
  useRolePreviewStore,
} from "@/lib/stores/role-preview-store";

/**
 * The bar across the top of the dashboard while an officer views it as a
 * role (#4072), like Discord's "You are viewing the server as" bar: it names
 * the role, says what the preview does and doesn't do, and Exit leads back to
 * the role's page. It stays on every route, so the way out is never behind a
 * door the previewed role lacks.
 */
export function RolePreviewBanner() {
  const router = useRouter();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const preview = useRolePreviewStore((s) =>
    activePreview(s.preview, activeChapterId),
  );
  const stop = useRolePreviewStore((s) => s.stop);
  if (!preview) return null;

  return (
    <div
      role="region"
      aria-labelledby="role-preview-title"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-accent-border bg-accent-subtle px-4 py-2"
    >
      <Eye aria-hidden className="h-4 w-4 shrink-0 text-accent-text" />
      <div className="min-w-0 flex-1">
        <p
          id="role-preview-title"
          className="text-sm font-bold text-accent-text"
        >
          Viewing as {preview.roleName}
        </p>
        <p className="text-caption text-muted-foreground">
          You see the pages and buttons this role gets. Changes are off until
          you exit.
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          stop();
          router.push(preview.returnTo);
        }}
      >
        Exit preview
      </Button>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  putSignedUpload,
  useActiveChapterId,
  useConfirmAvatar,
  useRemoveAvatar,
  useRequestAvatarUploadUrl,
} from "@repo/hooks";
import {
  MAX_UPLOAD_LABEL,
  acceptAttribute,
  inspectUploadFile,
  readSignedUpload,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/** The `image` kind's list, in the words a member reads. */
export const PHOTO_TYPE_REFUSAL =
  "Choose a JPG, PNG, GIF or WebP image. SVG and other files aren't accepted.";
export const PHOTO_SIZE_REFUSAL = `Choose an image up to ${MAX_UPLOAD_LABEL}.`;

/**
 * Change or remove the viewer's profile photo (#732).
 *
 * Three wire steps, the same as every signed upload here: mint a URL for the
 * caller's folder in the active chapter, PUT the bytes to it, then confirm the
 * path, which makes it the photo and deletes the one it replaced. The type and
 * size gate runs first, so a wrong file costs no request and reads as a
 * sentence rather than a storage error.
 *
 * The photo lands under the active chapter because that is the folder a
 * chapter departure purges (#711), so with no chapter there is nowhere to
 * upload to. Removing needs no chapter.
 */
export function ProfilePhotoControl({
  hasPhoto,
  disabled = false,
}: {
  hasPhoto: boolean;
  /** Offline, or the page is otherwise read-only. */
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const chapterId = useActiveChapterId();
  const requestUrl = useRequestAvatarUploadUrl();
  const confirm = useConfirmAvatar();
  const remove = useRemoveAvatar();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

  async function handleFile(file: File) {
    const inspected = inspectUploadFile("image", file);
    if (!inspected.ok) {
      toast({
        title:
          inspected.reason === "size"
            ? "That image is too large"
            : "That file isn't an image we accept",
        description:
          inspected.reason === "size" ? PHOTO_SIZE_REFUSAL : PHOTO_TYPE_REFUSAL,
        variant: "destructive",
      });
      return;
    }

    setBusy("upload");
    try {
      const ticket = await requestUrl.mutateAsync({
        filename: file.name,
        content_type: inspected.contentType,
        size_bytes: file.size,
      });
      const { signedUrl, storagePath } = readSignedUpload(ticket);
      await putSignedUpload({
        signedUrl,
        body: file,
        contentType: inspected.contentType,
      });
      await confirm.mutateAsync(storagePath);
      toast({
        title: "Photo updated",
        description: "Your chapter sees it in the directory and in chat.",
      });
    } catch (error) {
      toast({
        title: "Couldn't update your photo",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    setBusy("remove");
    try {
      await remove.mutateAsync();
      toast({ title: "Photo removed" });
    } catch (error) {
      toast({
        title: "Couldn't remove your photo",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  const uploadBlocked = disabled || busy !== null || !chapterId;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={acceptAttribute("image")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="profile-photo-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file again still fires `change`.
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={uploadBlocked}
        onClick={() => inputRef.current?.click()}
      >
        {busy === "upload" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : null}
        {hasPhoto ? "Change photo" : "Add photo"}
      </Button>
      {hasPhoto ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || busy !== null}
          onClick={() => void handleRemove()}
        >
          {busy === "remove" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          Remove
        </Button>
      ) : null}
      {!chapterId ? (
        <p className="w-full text-[12.5px] text-muted-foreground">
          Choose a chapter to add a photo.
        </p>
      ) : null}
    </div>
  );
}

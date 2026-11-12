/**
 * How long an audio file is, in seconds, as this browser reads it, or null
 * when it can't (a format the browser doesn't play). Nothing is uploaded or
 * played: only the file's header is read.
 */
export function readAudioDuration(
  file: Blob,
  timeoutMs = 15_000,
): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let done = false;
    const finish = (seconds: number | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    const read = () => {
      const { duration } = audio;
      if (Number.isFinite(duration) && duration > 0) finish(duration);
      else if (duration === Infinity) {
        // A recording with no length in its header: seeking past the end
        // makes the browser work it out, and `durationchange` fires again.
        audio.currentTime = 1e9;
      }
    };
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", read);
    audio.addEventListener("durationchange", read);
    audio.addEventListener("error", () => finish(null));
    audio.src = url;
  });
}

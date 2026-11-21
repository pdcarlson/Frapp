import { TranscriptPage } from "@/components/meetings/transcript-page";

export const metadata = {
  title: "Transcript",
};

/** A meeting's transcript on its own page (Paul, 2026-11-18). */
export default async function MeetingTranscript({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TranscriptPage id={id} />;
}

import { NoteTakerPage } from "@/components/meetings/note-takers";

export const metadata = {
  title: "Your notes",
};

/** A note-taker's own notes on someone else's minutes (#4935). */
export default async function MeetingNotes({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NoteTakerPage id={id} />;
}

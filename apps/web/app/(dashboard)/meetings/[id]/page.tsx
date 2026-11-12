import { MinutesPage } from "@/components/meetings/minutes-page";

export const metadata = {
  title: "Minutes",
};

export default async function Minutes({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MinutesPage id={id} />;
}

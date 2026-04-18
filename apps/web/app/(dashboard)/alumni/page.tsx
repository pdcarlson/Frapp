import { AlumniDirectory } from "@/components/alumni/alumni-directory";

export const metadata = {
  title: "Alumni",
  description: "Searchable alumni directory for the active chapter.",
};

export default function AlumniPage() {
  return <AlumniDirectory />;
}

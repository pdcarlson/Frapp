import { redirect } from "next/navigation";

// The standalone Roles & Permissions manager folded into Settings → Roles
// (Chunk 07b, #538), which renders it directly; this route only redirects.
export default function RolesPage() {
  redirect("/settings?tab=roles");
}

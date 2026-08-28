import { redirect } from "next/navigation";

// The standalone Roles & Permissions manager folded into Settings → Roles
// (Chunk 07b, #538). The live RBAC UI now lives in the "Live roles" sub-tab.
export default function RolesPage() {
  redirect("/settings?tab=roles");
}

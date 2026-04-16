import { redirect } from "next/navigation";

export default function DashboardEntryPage() {
  redirect("/dashboard/members");
}

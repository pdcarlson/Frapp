import { redirect } from "next/navigation";

// The standalone alumni directory folded into the Directory screen's Alumni
// tab (Wave 0 nav restructure). Kept as a redirect so existing links, chat
// messages, and bookmarks pointing at /alumni still land somewhere real —
// the same shape /roles uses to reach Settings → Roles.
export default function AlumniPage() {
  redirect("/members?tab=alumni");
}

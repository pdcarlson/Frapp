import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_CHAT } from "@/components/back-row";
import { SearchScreen, SEARCH_COPY } from "@/components/search/search-screen";

/**
 * Search (#5139), pushed from Chat home's Search round
 * (`spec/ui/mobile/navigation.md` § Search). `‹ Chat` goes back.
 */
export default function SearchRoute() {
  return (
    <ScreenShell
      back={BACK_TO_CHAT}
      title={SEARCH_COPY.title}
      keyboardShouldPersistTaps="handled"
    >
      <SearchScreen />
    </ScreenShell>
  );
}

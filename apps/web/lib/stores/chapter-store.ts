import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChapterState {
  activeChapterId: string | null;
  hasHydrated: boolean;
  setActiveChapterId: (id: string | null) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useChapterStore = create<ChapterState>()(
  persist(
    (set) => ({
      activeChapterId: null,
      hasHydrated: false,
      setActiveChapterId: (id) => set({ activeChapterId: id }),
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),
    }),
    {
      name: "frapp-active-chapter",
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

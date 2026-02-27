import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChapterState {
  activeChapterId: string | null;
  setActiveChapterId: (id: string | null) => void;
}

export const useChapterStore = create<ChapterState>()(
  persist(
    (set) => ({
      activeChapterId: null,
      setActiveChapterId: (id) => set({ activeChapterId: id }),
    }),
    {
      name: "frapp-active-chapter",
    },
  ),
);

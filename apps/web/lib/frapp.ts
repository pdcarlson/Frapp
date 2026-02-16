import { createFrappClient } from "@repo/api-sdk";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/v1";

export const frapp = createFrappClient({
  baseUrl: API_URL,
  getAuthToken: async () => {
    // On the web, we'll handle this via a hook or middleware injection
    // but for the raw client, we can provide a way to inject it.
    return null; 
  },
  getChapterId: () => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("frapp_chapter_id");
    }
    return null;
  },
});

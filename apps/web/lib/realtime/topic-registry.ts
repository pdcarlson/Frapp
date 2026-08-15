"use client";

// Re-export shim (#937 S3) — the one topic-registry implementation moved into
// @repo/chat-core so the chat manager and this app's non-chat realtime
// (`supabase-realtime.ts`) keep sharing it (#817). Delete in the cleanup PR
// once importers point at @repo/chat-core/topic-registry.
export * from "@repo/chat-core/topic-registry";

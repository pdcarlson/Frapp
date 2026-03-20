# ChatService Test Specification

This document details the test scenarios for `ChatService` in the `apps/api` workspace.

## getMessages

- **Should return messages without pagination options:**
  - Setup: Mock the `findByChannel` repository method to return an array of `ChatMessage`.
  - Execution: Call `getMessages` with only a `channelId`.
  - Assertion: Verify the repository method is called with `(channelId, undefined)` and the returned messages match the mock.
- **Should pass pagination options to repository:**
  - Setup: Mock the `findByChannel` repository method to return an array of `ChatMessage`.
  - Execution: Call `getMessages` with a `channelId` and an options object (e.g., `{ limit: 20, before: 'msg-5' }`).
  - Assertion: Verify the repository method is called with the provided options object and the returned messages match the mock.

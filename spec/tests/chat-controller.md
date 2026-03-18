# ChatController Unit Tests

This document outlines the test suite for the `ChatController` located at `apps/api/src/interface/controllers/chat.controller.ts`.

## Coverage

The test suite covers the following endpoints and functionalities:

### Channels
- `listChannels`: Verifies listing channels for a specific chapter.
- `getChannel`: Verifies fetching a specific channel by ID.
- `createChannel`: Verifies creation of a new channel with required permissions and categories.
- `updateChannel`: Verifies updating channel properties.
- `deleteChannel`: Verifies deletion of a channel.
- `getOrCreateDm`: Verifies the creation or retrieval of a 1-on-1 Direct Message channel.
- `createGroupDm`: Verifies the creation of a group DM channel, including deduplication of member IDs.

### Categories
- `listCategories`: Verifies listing of channel categories for a chapter.
- `createCategory`: Verifies creation of a new channel category.
- `updateCategory`: Verifies updating of a channel category.
- `deleteCategory`: Verifies deletion of a channel category.

### Messages
- `getMessages`: Verifies fetching messages with and without pagination limits and cursors.
- `sendMessage`: Verifies sending a new message to a channel.
- `editMessage`: Verifies modifying the content of an existing message.
- `deleteMessage`: Verifies soft deletion of a message.

### Pins
- `getPinnedMessages`: Verifies fetching pinned messages in a channel.
- `pinMessage`: Verifies pinning a specific message.
- `unpinMessage`: Verifies unpinning a specific message.

### Reactions
- `toggleReaction`: Verifies adding or removing a reaction (emoji) from a message.
- `getReactions`: Verifies retrieving all reactions for a specific message.

### File Uploads
- `requestUploadUrl`: Verifies generating a signed upload URL for a chat file attachment.

### Read Receipts
- `markRead`: Verifies marking a channel as read for the current user.

## Implementation Details

The tests are implemented using `@nestjs/testing`.
- `ChatService` is mocked to ensure isolation and verify correct parameter delegation.
- `SupabaseAuthGuard`, `ChapterGuard`, and `PermissionsGuard` are mocked to bypass authentication and authorization layers during unit testing.
